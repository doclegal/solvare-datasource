import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { searchFiltersSchema, exportConfigSchema, preparedRecordSchema, insertProcessedEcliSchema, type PreparedRecord, type PreparedBatch } from "@shared/schema";
import { searchDecisions, fetchDecisionContent, fetchFullText } from "./rechtspraak-api";
import { upsertRecordsToPinecone } from "./pinecone-client";
import { createChunksFromRecord } from "./chunking";
import { storage } from "./storage";
import { db, processedEclis } from "./db";
import { inArray, eq, and } from "drizzle-orm";
import { discoverECLIs, type DiscoveryProgress } from "./discovery/service";
import { generateAISummary } from "./openai-summary";
import { z } from "zod";

// Hardcoded Pinecone configuration for automatic upload
const PINECONE_INDEX_HOST = 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io';
const PINECONE_NAMESPACE = 'ECLI_NL';

export async function registerRoutes(app: Express): Promise<Server> {
  // Search Rechtspraak API
  app.post('/api/rechtspraak/search', async (req: Request, res: Response) => {
    try {
      const filters = searchFiltersSchema.parse(req.body);
      const result = await searchDecisions(filters);
      res.json(result);
    } catch (error: any) {
      console.error('Error in /api/rechtspraak/search:', error);
      res.status(500).json({ 
        error: error.message || 'Fout bij zoeken naar uitspraken' 
      });
    }
  });

  // Fetch full content for specific ECLIs
  app.post('/api/rechtspraak/content', async (req: Request, res: Response) => {
    try {
      const { eclis } = req.body;
      
      if (!Array.isArray(eclis) || eclis.length === 0) {
        return res.status(400).json({ error: 'ECLI lijst is vereist' });
      }

      const results = [];
      const errors = [];
      const filteredOut: Array<{ ecli: string; reason: string }> = [];

      // Fetch content for each ECLI with rate limiting
      for (let i = 0; i < eclis.length; i++) {
        const ecli = eclis[i];
        try {
          // Step 1: Fetch metadata only (AI enrichment is done separately via enrich-batch endpoint)
          const record = await fetchDecisionContent(ecli);
          
          console.log(`[${ecli}] ✓ Metadata only (skipping AI summary)`);
          
          results.push(record);
          
          // Small delay to avoid hammering the server
          if (i < eclis.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error: any) {
          console.error(`Error fetching ${ecli}:`, error);
          // Track non-civil cases separately
          if (error.message && error.message.includes('Niet-civiele zaak')) {
            filteredOut.push({
              ecli,
              reason: error.message.replace('Niet-civiele zaak: ', ''),
            });
            continue;
          }
          errors.push({
            ecli,
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        records: results,
        errors,
        filteredOut,
        total: eclis.length,
        successful: results.length,
        failed: errors.length,
        filtered: filteredOut.length,
      });
    } catch (error: any) {
      console.error('Error in /api/rechtspraak/content:', error);
      res.status(500).json({ 
        error: error.message || 'Fout bij ophalen van inhoud' 
      });
    }
  });

  // Enrich ECLIs with AI summaries (batch processing with SSE progress)
  app.post('/api/rechtspraak/enrich-batch', async (req: Request, res: Response) => {
    try {
      const { eclis, originalRecords } = req.body;
      
      if (!Array.isArray(eclis) || eclis.length === 0) {
        return res.status(400).json({ error: 'ECLI lijst is vereist' });
      }

      // Set up SSE for real-time progress with NO buffering
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      
      // Disable TCP buffering (Nagle's algorithm)
      if (req.socket) {
        req.socket.setNoDelay(true);
      }
      
      res.flushHeaders();

      const sendProgress = async (message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const data = `data: ${JSON.stringify({ type, message })}\n\n`;
        res.write(data);
        
        // Force flush to send immediately
        if ('flush' in res && typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
        
        // Small delay to ensure browser has time to process
        await new Promise(resolve => setImmediate(resolve));
      };

      // Validate that originalRecords covers all ECLIs
      if (!originalRecords || !Array.isArray(originalRecords)) {
        throw new Error('originalRecords is vereist voor AI enrichment');
      }
      
      const originalMap = new Map<string, PreparedRecord>();
      originalRecords.forEach((record: PreparedRecord) => {
        originalMap.set(record.ecli, record);
      });
      
      // Validate 1:1 mapping
      const missingEclis = eclis.filter(ecli => !originalMap.has(ecli));
      if (missingEclis.length > 0) {
        throw new Error(`Originele records ontbreken voor ECLIs: ${missingEclis.slice(0, 5).join(', ')}${missingEclis.length > 5 ? '...' : ''}`);
      }
      
      // Initialize IMMUTABLE baseline of original records
      // This ensures complete data even if enrichment fails mid-stream
      const initialRecords: PreparedRecord[] = eclis.map(ecli => originalMap.get(ecli)!);
      
      // Save initial batch immediately to prevent data loss (PostgreSQL survives restarts)
      let batch = await storage.createBatch([...initialRecords]); // Clone to avoid mutation issues
      console.log(`[AI Enrichment] Created initial batch ${batch.batchId} with ${initialRecords.length} original records in PostgreSQL`);
      
      const results: PreparedRecord[] = [];
      const errors: Array<{ ecli: string; error: string }> = [];
      
      // Track enriched records by ECLI for incremental updates
      const enrichedMap = new Map<string, PreparedRecord>();

      await sendProgress(`🤖 Starten met AI verrijking voor ${eclis.length} ECLI(s)...`, 'info');

      // Process each ECLI with AI enrichment + AUTOMATIC Pinecone upload
      for (let i = 0; i < eclis.length; i++) {
        const ecli = eclis[i];
        
        try {
          await sendProgress(`[${i + 1}/${eclis.length}] 📥 Ophalen ${ecli}...`, 'info');
          
          // Step 1: Fetch metadata
          const record = await fetchDecisionContent(ecli);
          
          // Step 2: Fetch full text
          await sendProgress(`[${i + 1}/${eclis.length}] 📄 Volledige tekst ophalen voor ${ecli}...`, 'info');
          const fullText = await fetchFullText(ecli);
          
          // Step 3: Generate AI summary
          await sendProgress(`[${i + 1}/${eclis.length}] 🤖 AI samenvatting genereren voor ${ecli}...`, 'info');
          const aiSummary = await generateAISummary(fullText, ecli);
          
          // Merge everything including AI title
          const enrichedRecord: PreparedRecord = {
            ...record,
            fullText,
            ai_title: aiSummary.title,
            ai_inhoudsindicatie: aiSummary.inhoudsindicatie,
            ai_feiten: aiSummary.feiten,
            ai_geschil: aiSummary.geschil,
            ai_beslissing: aiSummary.beslissing,
            ai_motivering: aiSummary.motivering,
          };
          
          // Debug: Log enriched record to verify ai_title is set
          console.log(`[${ecli}] Enriched record ai_title: "${enrichedRecord.ai_title}"`);
          
          results.push(enrichedRecord);
          enrichedMap.set(ecli, enrichedRecord);
          
          // Upsert enriched record to PostgreSQL (incremental, survives crashes)
          await storage.upsertEnrichedRecord(batch.batchId, enrichedRecord);
          
          await sendProgress(`[${i + 1}/${eclis.length}] ✅ ${ecli} succesvol verrijkt`, 'success');
          
          // Small delay to avoid hammering APIs
          if (i < eclis.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error: any) {
          console.error(`Error enriching ${ecli}:`, error);
          errors.push({
            ecli,
            error: error.message,
          });
          await sendProgress(`[${i + 1}/${eclis.length}] ❌ Fout bij ${ecli}: ${error.message}`, 'error');
        }
      }

      // Build final merged records (enriched + original)
      const finalRecords = initialRecords.map(original => 
        enrichedMap.get(original.ecli) || original
      );
      
      // Batch is already up-to-date thanks to incremental updates during enrichment
      console.log(`[AI Enrichment] Final batch ${batch.batchId}: ${finalRecords.length} total records (${results.length} enriched, ${errors.length} failed)`);
      
      // Strip fullText from records to prevent SSE payload overflow
      const recordsWithoutFullText = finalRecords.map(({ fullText, ...record }) => record);
      
      // Send completion event with batch ID (no fullText)
      const completionData = `data: ${JSON.stringify({
        type: 'complete',
        records: recordsWithoutFullText, // Send without fullText to avoid SSE overflow
        errors,
        total: eclis.length,
        successful: results.length,
        failed: errors.length,
        batchId: batch.batchId,
      })}\n\n`;
      res.write(completionData);
      if ('flush' in res && typeof (res as any).flush === 'function') {
        (res as any).flush();
      }

      res.end();
    } catch (error: any) {
      console.error('Error in /api/rechtspraak/enrich-batch:', error);
      
      const errorData = `data: ${JSON.stringify({
        type: 'error',
        message: error.message || 'Fout bij verrijken van ECLIs',
      })}\n\n`;
      res.write(errorData);
      if ('flush' in res && typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
      
      res.end();
    }
  });

  // Create or update batch from records (for accumulated multi-fetch workflow)
  app.post('/api/rechtspraak/create-batch', async (req: Request, res: Response) => {
    try {
      const { records, batchId: existingBatchId } = req.body;
      
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'Records lijst is vereist' });
      }

      // Validate records schema
      try {
        records.forEach((record: any) => {
          preparedRecordSchema.parse(record);
        });
      } catch (validationError: any) {
        return res.status(400).json({ 
          error: 'Ongeldige record data', 
          details: validationError.message 
        });
      }

      let batch: PreparedBatch;
      if (existingBatchId) {
        try {
          batch = await storage.updateBatch(existingBatchId, records);
          console.log(`Updated batch ${existingBatchId} with ${records.length} records`);
        } catch (error: any) {
          // If batch doesn't exist, create new one
          batch = await storage.createBatch(records);
          console.log(`Batch ${existingBatchId} not found, created new batch ${batch.batchId} with ${records.length} records`);
        }
      } else {
        batch = await storage.createBatch(records);
        console.log(`Created new batch ${batch.batchId} with ${records.length} records`);
      }
      
      res.json({
        success: true,
        batchId: batch.batchId,
        recordCount: records.length,
      });
    } catch (error: any) {
      console.error('Error in /api/rechtspraak/create-batch:', error);
      res.status(500).json({ 
        error: error.message || 'Fout bij aanmaken van batch' 
      });
    }
  });

  // Prepare chunks from prepared records using batchId
  app.post('/api/rechtspraak/prepare-chunks', async (req: Request, res: Response) => {
    try {
      const { batchId } = req.body;
      
      if (!batchId) {
        return res.status(400).json({ error: 'batchId is vereist' });
      }

      // Retrieve records from server-side storage
      const batch = await storage.getBatch(batchId);
      if (!batch) {
        return res.status(404).json({ 
          error: 'Batch niet gevonden. Records zijn mogelijk verlopen of verwijderd.' 
        });
      }

      const records = batch.records;
      const allChunks = [];
      const chunksByEcli: Record<string, any> = {};

      for (const record of records) {
        const chunks = createChunksFromRecord(record);
        allChunks.push(...chunks);
        
        // Group by section type for preview
        const sectionCounts = chunks.reduce((acc, chunk) => {
          acc[chunk.section_type] = (acc[chunk.section_type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        chunksByEcli[record.ecli] = {
          ecli: record.ecli,
          title: record.title,
          totalChunks: chunks.length,
          sectionCounts,
          chunks,
        };
      }

      res.json({
        success: true,
        totalChunks: allChunks.length,
        totalRecords: records.length,
        chunksByEcli,
        allChunks,
      });
    } catch (error: any) {
      console.error('Error in /api/rechtspraak/prepare-chunks:', error);
      res.status(500).json({ 
        error: error.message || 'Fout bij voorbereiden van chunks' 
      });
    }
  });

  // Prepare chunks using LLM classification (new parallel method)
  app.post('/api/rechtspraak/prepare-chunks-llm', async (req: Request, res: Response) => {
    try {
      const { batchId } = req.body;
      
      if (!batchId) {
        return res.status(400).json({ error: 'batchId is verplicht' });
      }
      
      // Get batch from storage
      const batch = await storage.getBatch(batchId);
      if (!batch) {
        return res.status(404).json({ error: 'Batch niet gevonden' });
      }
      
      console.log(`[LLM Chunking] Preparing ${batch.records.length} records with LLM classification`);
      
      // Use LLM-based chunking
      const { prepareChunksWithLLM } = await import('./chunking-llm');
      const result = await prepareChunksWithLLM(batch.records);
      
      res.json({
        success: true,
        totalChunks: result.totalChunks,
        totalRecords: result.totalRecords,
        fallbackCount: result.fallbackCount,
        method: 'llm',
        chunks: result.chunks,
      });
    } catch (error: any) {
      console.error('Error in /api/rechtspraak/prepare-chunks-llm:', error);
      res.status(500).json({ 
        error: error.message || 'Fout bij LLM chunking' 
      });
    }
  });

  // Export to Pinecone (streaming progress)
  app.post('/api/pinecone/export', async (req: Request, res: Response) => {
    try {
      const config = exportConfigSchema.parse(req.body);
      
      // Support both records and chunks
      const dataToExport = config.chunks || config.records || [];
      
      if (dataToExport.length === 0) {
        throw new Error('Geen records of chunks om te exporteren');
      }
      
      // Set up SSE (Server-Sent Events) for streaming progress
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendProgress({
        type: 'start',
        message: 'Export naar Pinecone gestart...',
        totalRecords: dataToExport.length,
      });

      const result = await upsertRecordsToPinecone(
        config.indexHost,
        dataToExport,
        config.namespace,
        config.batchSize,
        (progress) => {
          sendProgress({
            type: 'progress',
            ...progress,
          });
        }
      );

      sendProgress({
        type: 'complete',
        message: 'Export voltooid',
        ...result,
      });

      res.end();
    } catch (error: any) {
      console.error('Error in /api/pinecone/export:', error);
      
      // Send error through SSE if headers already sent
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: error.message || 'Fout bij exporteren naar Pinecone'
        })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ 
          error: error.message || 'Fout bij exporteren naar Pinecone' 
        });
      }
    }
  });

  // Debug: Get Pinecone index stats
  app.get('/api/pinecone/stats', async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'PINECONE_API_KEY niet gevonden' });
      }
      
      const { Pinecone } = await import('@pinecone-database/pinecone');
      const pc = new Pinecone({ apiKey });
      
      const indexHost = 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io';
      const indexName = indexHost.split('.')[0];
      const index = pc.index(indexName, indexHost);
      
      const stats = await index.describeIndexStats();
      
      res.json({
        indexName,
        indexHost,
        totalVectors: stats.totalRecordCount,
        namespaces: stats.namespaces,
      });
    } catch (error: any) {
      console.error('Error getting Pinecone stats:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Debug: Fetch specific ECLI from Pinecone
  app.post('/api/pinecone/fetch', async (req: Request, res: Response) => {
    try {
      const { eclis, namespace } = req.body;
      
      if (!Array.isArray(eclis) || eclis.length === 0) {
        return res.status(400).json({ error: 'ECLI lijst is vereist' });
      }
      
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'PINECONE_API_KEY niet gevonden' });
      }
      
      const { Pinecone } = await import('@pinecone-database/pinecone');
      const pc = new Pinecone({ apiKey });
      
      const indexHost = 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io';
      const indexName = indexHost.split('.')[0];
      const index = pc.index(indexName, indexHost);
      const ns = index.namespace(namespace || 'ECLI_NL');
      
      const result = await ns.fetch(eclis);
      
      res.json({
        namespace: namespace || 'ECLI_NL',
        requested: eclis,
        found: Object.keys(result.records || {}).length,
        records: result.records,
      });
    } catch (error: any) {
      console.error('Error fetching from Pinecone:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Re-upload existing Pinecone records with court_level metadata
  // Prioritizes AI-enriched versions to preserve expensive AI summaries
  app.post('/api/pinecone/update-court-levels', async (req: Request, res: Response) => {
    try {
      const { detectCourtLevel } = await import('./court-utils');
      const { enrichedBatchRecords } = await import('@shared/schema');
      
      // Get all processed ECLIs from database
      const allProcessedEclis = await db
        .select({ ecli: processedEclis.ecli })
        .from(processedEclis)
        .where(eq(processedEclis.namespace, 'ECLI_NL'));
      
      const ecliList = allProcessedEclis.map(r => r.ecli);
      console.log(`[Update Court Levels] Found ${ecliList.length} processed ECLIs to re-upload`);
      
      if (ecliList.length === 0) {
        return res.json({ message: 'Geen records om te updaten', updated: 0 });
      }
      
      // Get records from database, prioritizing AI-enriched versions
      const allBatchRecords = await db
        .select()
        .from(enrichedBatchRecords)
        .where(inArray(
          enrichedBatchRecords.ecli,
          ecliList
        ))
        .orderBy(enrichedBatchRecords.isEnriched); // false first, true last (so enriched overwrites)
      
      console.log(`[Update Court Levels] Found ${allBatchRecords.length} total records in database`);
      
      // Deduplicate: keep only the best version (AI-enriched if available) per ECLI
      const recordMap = new Map<string, { record: PreparedRecord; isEnriched: boolean }>();
      
      for (const dbRecord of allBatchRecords) {
        const record = dbRecord.recordData as any as PreparedRecord;
        const ecli = record.ecli;
        
        // ALWAYS recompute court_level to fix previously misclassified records
        if (record.court) {
          record.courtLevel = detectCourtLevel(record.court);
        }
        
        // Only add/overwrite if this is enriched OR we don't have this ECLI yet
        if (dbRecord.isEnriched || !recordMap.has(ecli)) {
          recordMap.set(ecli, { record, isEnriched: dbRecord.isEnriched });
        }
      }
      
      const recordsToUpload = Array.from(recordMap.values()).map(item => item.record);
      
      // Count enriched vs baseline AFTER deduplication
      const enrichedCount = Array.from(recordMap.values()).filter(item => item.isEnriched).length;
      const baselineCount = recordsToUpload.length - enrichedCount;
      
      console.log(`[Update Court Levels] Prepared ${recordsToUpload.length} records for re-upload:`);
      console.log(`  - ${enrichedCount} AI-enriched records (preserving AI summaries)`);
      console.log(`  - ${baselineCount} baseline records`);
      
      if (recordsToUpload.length === 0) {
        return res.json({ 
          message: 'Geen records gevonden in database om te updaten', 
          updated: 0,
          total: ecliList.length 
        });
      }
      
      // Re-upload to Pinecone using existing upload function
      const result = await upsertRecordsToPinecone(
        'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io',
        recordsToUpload,
        'ECLI_NL',
        96,
        (progress) => {
          if (progress.processedRecords % 50 === 0) {
            console.log(`[Update Court Levels] Progress: ${progress.processedRecords}/${progress.totalRecords} records uploaded`);
          }
        }
      );
      
      res.json({
        message: `Successfully re-uploaded ${result.successCount} records with court_level metadata`,
        updated: result.successCount,
        enriched: enrichedCount,
        baseline: baselineCount,
        errors: result.errorCount,
        total: recordsToUpload.length,
      });
    } catch (error: any) {
      console.error('Error updating court levels:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete Pinecone records without AI summaries
  app.post('/api/pinecone/delete-without-ai', async (req: Request, res: Response) => {
    try {
      const { confirm } = req.body;
      
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'PINECONE_API_KEY niet gevonden' });
      }
      
      const { Pinecone } = await import('@pinecone-database/pinecone');
      const pc = new Pinecone({ apiKey });
      
      const indexHost = 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io';
      const indexName = indexHost.split('.')[0];
      const index = pc.index(indexName, indexHost);
      const ns = index.namespace('ECLI_NL');
      
      // Get all ECLIs from processed_eclis table
      const allProcessedEclis = await db
        .select({ ecli: processedEclis.ecli })
        .from(processedEclis)
        .where(eq(processedEclis.namespace, 'ECLI_NL'));
      
      const ecliList = allProcessedEclis.map(r => r.ecli);
      console.log(`[Delete Without AI] Found ${ecliList.length} processed ECLIs to check`);
      
      if (ecliList.length === 0) {
        return res.json({ message: 'Geen records gevonden', deleted: 0 });
      }
      
      // Fetch all records and check for AI summaries
      const recordsToDelete: string[] = [];
      const batchSize = 100;
      
      for (let i = 0; i < ecliList.length; i += batchSize) {
        const batch = ecliList.slice(i, i + batchSize);
        const fetchResult = await ns.fetch(batch);
        const records = fetchResult.records || {};
        
        // Find records without AI enrichment
        // Check for AI title (new format) OR legacy has_ai_summary flag
        for (const [ecli, record] of Object.entries(records)) {
          const hasAITitle = !!record.metadata?.ai_title;
          const hasLegacyFlag = record.metadata?.has_ai_summary === true;
          
          // Keep records that have either the new AI title or the legacy flag
          if (!hasAITitle && !hasLegacyFlag) {
            recordsToDelete.push(ecli);
          }
        }
      }
      
      console.log(`[Delete Without AI] Found ${recordsToDelete.length} records without AI summaries`);
      
      // If not confirmed, just return the count
      if (!confirm) {
        return res.json({
          message: `Gevonden: ${recordsToDelete.length} records zonder AI samenvatting`,
          count: recordsToDelete.length,
          total: ecliList.length,
          preview: recordsToDelete.slice(0, 10), // Show first 10
        });
      }
      
      // Delete records in batches
      let deletedCount = 0;
      const deleteBatchSize = 100;
      const errors: string[] = [];
      
      for (let i = 0; i < recordsToDelete.length; i += deleteBatchSize) {
        const batch = recordsToDelete.slice(i, i + deleteBatchSize);
        
        try {
          await ns.deleteMany(batch);
          deletedCount += batch.length;
          
          if (deletedCount % 500 === 0) {
            console.log(`[Delete Without AI] Progress: ${deletedCount}/${recordsToDelete.length} verwijderd`);
          }
        } catch (error: any) {
          console.error(`[Delete Without AI] Error deleting batch at index ${i}:`, error);
          errors.push(`Batch ${i}-${i + batch.length}: ${error.message}`);
        }
        
        // Small delay to avoid rate limiting
        if (i + deleteBatchSize < recordsToDelete.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`[Delete Without AI] Completed: ${deletedCount} records verwijderd, ${errors.length} errors`);
      
      // Verify deletion by checking a sample (only if no errors occurred)
      let verified = false;
      if (errors.length === 0 && deletedCount > 0) {
        const sampleSize = Math.min(10, deletedCount);
        const sampleEclis = recordsToDelete.slice(0, sampleSize);
        const verifyResult = await ns.fetch(sampleEclis);
        const actuallyDeleted = sampleSize - Object.keys(verifyResult.records || {}).length;
        verified = actuallyDeleted === sampleSize;
        console.log(`[Delete Without AI] Verification: ${actuallyDeleted}/${sampleSize} sample records confirmed deleted`);
      } else if (errors.length > 0) {
        console.log(`[Delete Without AI] Skipping verification due to ${errors.length} batch errors`);
      }
      
      res.json({
        message: `${deletedCount} records zonder AI samenvatting verwijderd`,
        deleted: deletedCount,
        total: ecliList.length,
        remaining: ecliList.length - deletedCount,
        errors: errors.length > 0 ? errors : undefined,
        verified,
      });
    } catch (error: any) {
      console.error('Error deleting records without AI:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get batch by ID (for AI enrichment recovery)
  app.get('/api/rechtspraak/batch/:batchId', async (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;
      const batch = await storage.getBatch(batchId);
      
      if (!batch) {
        return res.status(404).json({ error: 'Batch niet gevonden' });
      }
      
      res.json({ 
        success: true, 
        batch,
        message: `Batch met ${batch.records.length} records opgehaald` 
      });
    } catch (error: any) {
      console.error('Error fetching batch:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cleanup batch (manual deletion)
  app.delete('/api/rechtspraak/batch/:batchId', async (req: Request, res: Response) => {
    const { batchId } = req.params;
    await storage.deleteBatch(batchId);
    res.json({ success: true, message: 'Batch verwijderd' });
  });

  // Cleanup old batches (manual trigger)
  app.post('/api/rechtspraak/cleanup-batches', async (req: Request, res: Response) => {
    const maxAgeMs = req.body.maxAgeMs || 30 * 60 * 1000; // Default: 30 minutes
    const deletedCount = await storage.cleanupOldBatches(maxAgeMs);
    res.json({ 
      success: true, 
      deletedCount,
      message: `${deletedCount} oude batches verwijderd` 
    });
  });

  // Check which ECLIs are already processed
  app.post('/api/processed-eclis/check', async (req: Request, res: Response) => {
    try {
      const { eclis, namespace } = req.body;
      
      if (!Array.isArray(eclis) || eclis.length === 0) {
        return res.status(400).json({ error: 'ECLI lijst is vereist' });
      }
      
      if (!namespace) {
        return res.status(400).json({ error: 'Namespace is vereist' });
      }
      
      // Query database for already processed ECLIs in this specific namespace
      const processed = await db
        .select({ ecli: processedEclis.ecli })
        .from(processedEclis)
        .where(
          and(
            eq(processedEclis.namespace, namespace),
            inArray(processedEclis.ecli, eclis)
          )
        );
      
      const processedEcliSet = new Set(processed.map(p => p.ecli));
      const newEclis = eclis.filter(ecli => !processedEcliSet.has(ecli));
      
      res.json({
        total: eclis.length,
        alreadyProcessed: processed.length,
        new: newEclis.length,
        processedEclis: Array.from(processedEcliSet),
        newEclis,
      });
    } catch (error: any) {
      console.error('Error checking processed ECLIs:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Mark ECLIs as processed after successful upload
  app.post('/api/processed-eclis/mark', async (req: Request, res: Response) => {
    try {
      const { eclis, namespace } = req.body;
      
      if (!Array.isArray(eclis) || eclis.length === 0) {
        return res.status(400).json({ error: 'ECLI lijst is vereist' });
      }
      
      if (!namespace) {
        return res.status(400).json({ error: 'Namespace is vereist' });
      }
      
      // Insert processed ECLIs (ignore duplicates)
      const values = eclis.map(ecli => ({ ecli, namespace }));
      
      // Use ON CONFLICT DO NOTHING to avoid duplicate key errors
      const inserted = await db
        .insert(processedEclis)
        .values(values)
        .onConflictDoNothing()
        .returning();
      
      res.json({
        success: true,
        marked: inserted.length,
        total: eclis.length,
        message: `${inserted.length} nieuwe ECLI's gemarkeerd als verwerkt`,
      });
    } catch (error: any) {
      console.error('Error marking ECLIs as processed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear processed ECLIs database (useful for re-uploading all records)
  app.delete('/api/processed-eclis/clear', async (req: Request, res: Response) => {
    try {
      const { namespace } = req.body;
      
      if (!namespace) {
        return res.status(400).json({ error: 'Namespace is vereist' });
      }
      
      // Delete all processed ECLIs for the given namespace
      const deleted = await db
        .delete(processedEclis)
        .where(eq(processedEclis.namespace, namespace))
        .returning();
      
      res.json({
        success: true,
        deleted: deleted.length,
        message: `${deleted.length} ECLI's verwijderd uit verwerkte database`,
      });
    } catch (error: any) {
      console.error('Error clearing processed ECLIs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ECLI Discovery endpoint with breadth-first section crawling
  app.post('/api/ecli-discovery/ingest', async (req: Request, res: Response) => {
    try {
      const { sourceUrls, namespace, config } = z.object({
        sourceUrls: z.array(z.string().url()),
        namespace: z.string().default('ECLI_NL'),
        config: z.object({
          maxDepth: z.number().min(1).max(10).optional(),
          maxPages: z.number().min(1).max(500).optional(),
          delayMs: z.number().min(100).max(5000).optional(),
        }).optional(),
      }).parse(req.body);
      
      // Set up SSE with proper headers to prevent buffering
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      
      // Disable TCP buffering (Nagle's algorithm)
      if (req.socket) {
        req.socket.setNoDelay(true);
      }
      
      res.flushHeaders();
      
      const sendProgress = async (progress: DiscoveryProgress) => {
        console.log('[SSE] Sending progress:', progress.type, progress.message);
        const data = `data: ${JSON.stringify(progress)}\n\n`;
        res.write(data);
        
        // Force flush to send immediately
        if ('flush' in res && typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
        
        // Small delay to ensure browser has time to process
        await new Promise(resolve => setImmediate(resolve));
      };
      
      // Run discovery with section crawling
      const { preparedRecords, results } = await discoverECLIs(
        sourceUrls,
        namespace,
        config || {},
        sendProgress
      );
      
      // Send completion event with prepared records
      const completionData = `data: ${JSON.stringify({
        type: 'discovery_complete',
        preparedRecords,
        results,
        totalRecords: preparedRecords.length,
      })}\n\n`;
      res.write(completionData);
      if ('flush' in res && typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
      
      res.end();
    } catch (error: any) {
      console.error('Error in ECLI discovery:', error);
      
      // Send error via SSE
      const errorData = `data: ${JSON.stringify({
        type: 'error',
        message: error.message || 'Discovery failed',
      })}\n\n`;
      res.write(errorData);
      if ('flush' in res && typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
      
      res.end();
    }
  });

  // Health check endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      pineconeConfigured: !!process.env.PINECONE_API_KEY,
    });
  });

  // Auto-cleanup old batches every 10 minutes
  setInterval(async () => {
    const deletedCount = await storage.cleanupOldBatches(30 * 60 * 1000);
    if (deletedCount > 0) {
      console.log(`Auto-cleanup: ${deletedCount} oude batches verwijderd`);
    }
  }, 10 * 60 * 1000);

  const httpServer = createServer(app);
  return httpServer;
}
