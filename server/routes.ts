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
          
          // Tag as API search origin → goes to ECLI_NL namespace
          results.push({
            ...record,
            source: 'api_search',
          });
          
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
      const { eclis, originalRecords, resumeBatchId } = req.body;
      
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
      
      // RESUME FUNCTIONALITY: Check if we're resuming an existing batch
      let batch: PreparedBatch;
      let alreadyEnrichedMap = new Map<string, PreparedRecord>();
      
      if (resumeBatchId) {
        const existingBatch = await storage.getBatch(resumeBatchId);
        if (!existingBatch) {
          throw new Error(`Batch ${resumeBatchId} niet gevonden - kan niet hervatten`);
        }
        
        batch = existingBatch;
        
        // Extract already enriched records
        existingBatch.records.forEach(record => {
          if (record.ai_title || record.ai_inhoudsindicatie) {
            alreadyEnrichedMap.set(record.ecli, record);
          }
        });
        
        console.log(`[AI Enrichment] Resuming batch ${batch.batchId}: ${alreadyEnrichedMap.size} already enriched, ${eclis.length - alreadyEnrichedMap.size} remaining`);
        await sendProgress(`🔄 Hervatten batch ${resumeBatchId}: ${alreadyEnrichedMap.size} al verrijkt, ${eclis.length - alreadyEnrichedMap.size} te verrijken`, 'info');
      } else {
        // Create new batch
        batch = await storage.createBatch([...initialRecords]); // Clone to avoid mutation issues
        console.log(`[AI Enrichment] Created initial batch ${batch.batchId} with ${initialRecords.length} original records in PostgreSQL`);
      }
      
      // AUTO-UPLOAD WORKER DISABLED - Manual upload only via button
      // const { getGlobalAutoUploadWorker } = await import('./auto-upload-worker');
      // const uploadWorker = getGlobalAutoUploadWorker();
      // uploadWorker.start().catch(err => console.error('[Auto-Upload] Worker start failed:', err));
      // await sendProgress(`📤 Auto-upload worker actief (upload batches van 25 elke 5 min)`, 'info');
      
      const results: PreparedRecord[] = [];
      const errors: Array<{ ecli: string; error: string }> = [];
      
      // Track enriched records by ECLI for incremental updates (includes already enriched from resume)
      const enrichedMap = new Map<string, PreparedRecord>(alreadyEnrichedMap);

      // Filter ECLIs: only enrich those not already enriched
      const eclisToEnrich = eclis.filter(ecli => !alreadyEnrichedMap.has(ecli));
      const skippedCount = eclis.length - eclisToEnrich.length;
      
      if (skippedCount > 0) {
        await sendProgress(`⏭️ ${skippedCount} record(s) al verrijkt - overgeslagen`, 'info');
      }
      
      await sendProgress(`🤖 Starten met AI verrijking voor ${eclisToEnrich.length} ECLI(s)...`, 'info');

      // Process each ECLI with AI enrichment
      for (let i = 0; i < eclisToEnrich.length; i++) {
        const ecli = eclisToEnrich[i];
        const overallProgress = skippedCount + i + 1; // Include skipped records in total count
        
        try {
          await sendProgress(`[${overallProgress}/${eclis.length}] 📥 Ophalen ${ecli}...`, 'info');
          
          // Step 1: Fetch metadata
          const record = await fetchDecisionContent(ecli);
          
          // Step 2: Fetch full text
          await sendProgress(`[${overallProgress}/${eclis.length}] 📄 Volledige tekst ophalen voor ${ecli}...`, 'info');
          const fullText = await fetchFullText(ecli);
          
          // Step 3: Generate AI summary
          await sendProgress(`[${overallProgress}/${eclis.length}] 🤖 AI samenvatting genereren voor ${ecli}...`, 'info');
          const aiSummary = await generateAISummary(fullText, ecli);
          
          // Merge everything including AI title AND preserve source from original record
          const originalRecord = originalMap.get(ecli)!;
          const enrichedRecord: PreparedRecord = {
            ...record,
            source: originalRecord.source, // CRITICAL: Preserve source for namespace routing
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
          
          await sendProgress(`[${overallProgress}/${eclis.length}] ✅ ${ecli} succesvol verrijkt`, 'success');
          
          // Small delay to avoid hammering APIs
          if (i < eclisToEnrich.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error: any) {
          console.error(`Error enriching ${ecli}:`, error);
          errors.push({
            ecli,
            error: error.message,
          });
          await sendProgress(`[${overallProgress}/${eclis.length}] ❌ Fout bij ${ecli}: ${error.message}`, 'error');
          
          // IMPORTANT: Continue with next record even if one fails
          console.log(`[AI Enrichment] Continuing with next record after error in ${ecli}`);
        }
      }

      // Build final merged records (enriched + original)
      const finalRecords = initialRecords.map(original => 
        enrichedMap.get(original.ecli) || original
      );
      
      // Batch is already up-to-date thanks to incremental updates during enrichment
      console.log(`[AI Enrichment] Final batch ${batch.batchId}: ${finalRecords.length} total records (${results.length} enriched, ${errors.length} failed)`);
      
      // TRIGGER IMMEDIATE UPLOAD after enrichment completes
      if (results.length > 0) {
        await sendProgress(`📤 Starten met upload van ${results.length} verrijkte records naar Pinecone...`, 'info');
        
        // Auto-upload disabled - Manual upload only
        // uploadWorker.checkAndUpload().catch((err: any) => {
        //   console.error('[Auto-Upload] Immediate upload failed:', err);
        // });
      }
      
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

  // Auto-upload enriched records to Pinecone (streaming progress via SSE)
  app.post('/api/pinecone/auto-upload-monitor', async (req: Request, res: Response) => {
    try {
      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if ('flush' in res && typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      };

      // AUTO-UPLOAD WORKER DISABLED - Manual upload only via button
      // const { getGlobalAutoUploadWorker } = await import('./auto-upload-worker');
      // const worker = getGlobalAutoUploadWorker();
      // worker.addProgressListener(sendProgress);
      // await worker.start();

      // Keep connection open for progress updates
      req.on('close', () => {
        // Cleanup: remove listener when client disconnects
        // worker.removeProgressListener(sendProgress);
      });

    } catch (error: any) {
      console.error('Error in /api/pinecone/auto-upload-monitor:', error);
      
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          message: error.message || 'Fout bij auto-upload monitoring'
        })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ 
          error: error.message || 'Fout bij auto-upload monitoring' 
        });
      }
    }
  });

  // Save current records as a draft batch (24-hour retention)
  app.post('/api/batches/save', async (req: Request, res: Response) => {
    try {
      const { records } = req.body;
      
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'Records lijst is vereist' });
      }

      // Validate records schema - catch Zod errors separately for proper 400 response
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

      // Create batch in PostgreSQL (persistent storage)
      const batch = await storage.createBatch(records);
      
      // Cleanup old batches (>24 hours)
      const deleted = await storage.cleanupOldBatches(24 * 60 * 60 * 1000);
      if (deleted > 0) {
        console.log(`[Batch Cleanup] Removed ${deleted} batches older than 24 hours`);
      }
      
      res.json({ 
        success: true, 
        batchId: batch.batchId,
        recordCount: records.length,
        message: `${records.length} records opgeslagen. Automatisch verwijderd na 24 uur.`
      });
    } catch (error: any) {
      console.error('Error in /api/batches/save:', error);
      res.status(500).json({ error: error.message || 'Kon batch niet opslaan' });
    }
  });

  // List saved batches (most recent first)
  app.get('/api/batches/list', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const batches = await storage.listBatches(limit);
      
      res.json({ batches });
    } catch (error: any) {
      console.error('Error in /api/batches/list:', error);
      res.status(500).json({ error: error.message || 'Kon batches niet ophalen' });
    }
  });

  // Load a specific batch by ID
  app.get('/api/batches/:batchId', async (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;
      const batch = await storage.getBatch(batchId);
      
      if (!batch) {
        return res.status(404).json({ error: 'Batch niet gevonden' });
      }
      
      res.json({ batch });
    } catch (error: any) {
      console.error('Error in /api/batches/:batchId:', error);
      res.status(500).json({ error: error.message || 'Kon batch niet ophalen' });
    }
  });

  // Delete a batch
  app.delete('/api/batches/:batchId', async (req: Request, res: Response) => {
    try {
      const { batchId } = req.params;
      await storage.deleteBatch(batchId);
      
      res.json({ success: true, message: 'Batch verwijderd' });
    } catch (error: any) {
      console.error('Error in /api/batches/:batchId DELETE:', error);
      res.status(500).json({ error: error.message || 'Kon batch niet verwijderen' });
    }
  });

  // SIMPLE TEST: AI samenvatting voor 1 record
  app.post('/api/ai/test-summary', async (req: Request, res: Response) => {
    try {
      const { ecli, rechtspraakUrl } = req.body;
      
      console.log(`[AI Test] Generating summary for ${ecli}`);
      console.log(`[AI Test] Rechtspraak URL: ${rechtspraakUrl}`);
      
      // Fetch full text
      const fullText = await fetchFullText(ecli);
      
      if (!fullText || fullText.trim().length < 100) {
        return res.status(400).json({ error: 'Geen volledige tekst beschikbaar' });
      }
      
      console.log(`[AI Test] Full text length: ${fullText.length} characters`);
      
      // Generate AI summary
      const aiSummary = await generateAISummary(fullText, ecli);
      
      console.log(`[AI Test] Summary generated successfully`);
      
      // Return complete summary
      res.json({
        success: true,
        ecli,
        rechtspraakUrl,
        summary: {
          title: aiSummary.title,
          inhoudsindicatie: aiSummary.inhoudsindicatie,
          feiten: aiSummary.feiten,
          geschil: aiSummary.geschil,
          beslissing: aiSummary.beslissing,
          motivering: aiSummary.motivering,
        }
      });
    } catch (error: any) {
      console.error('[AI Test] Error:', error);
      res.status(500).json({ error: error.message || 'AI samenvatting failed' });
    }
  });

  // NEW: AI Enrichment endpoint - clean rebuild without circular references
  app.post('/api/ai/enrich', async (req: Request, res: Response) => {
    try {
      const { eclis, resumeBatchId } = req.body;
      
      if (!Array.isArray(eclis) || eclis.length === 0) {
        return res.status(400).json({ error: 'ECLIs lijst is vereist' });
      }

      console.log(`[AI Enrich] Starting enrichment for ${eclis.length} ECLIs`);
      if (resumeBatchId) {
        console.log(`[AI Enrich] Resuming batch: ${resumeBatchId}`);
      }

      const enrichedRecords: PreparedRecord[] = [];
      const errors: Array<{ ecli: string; error: string }> = [];

      // Process each ECLI: fetch metadata + full text, generate AI summary
      for (let i = 0; i < eclis.length; i++) {
        const ecli = eclis[i];
        
        try {
          console.log(`[${i + 1}/${eclis.length}] Processing ${ecli}...`);
          
          // Step 1: Fetch metadata only (lightweight, no full text yet)
          const metadata = await fetchDecisionContent(ecli);
          
          // Step 2: Check if already enriched (skip if has ai_title)
          if (resumeBatchId && metadata.ai_title) {
            console.log(`[${ecli}] Already enriched, skipping`);
            enrichedRecords.push(metadata);
            continue;
          }
          
          // Step 3: Fetch full text for AI enrichment
          console.log(`[${ecli}] Fetching full text...`);
          const fullText = await fetchFullText(ecli);
          
          if (!fullText || fullText.trim().length < 100) {
            console.warn(`[${ecli}] No full text available, skipping AI enrichment`);
            enrichedRecords.push(metadata);
            continue;
          }
          
          // Step 4: Generate AI summary
          console.log(`[${ecli}] Generating AI summary...`);
          const aiSummary = await generateAISummary(fullText, ecli);
          
          // Step 5: Create clean enriched record (plain object, no circular refs)
          const enrichedRecord: PreparedRecord = {
            ecli: metadata.ecli,
            title: metadata.title,
            court: metadata.court,
            decisionDate: metadata.decisionDate,
            legalArea: metadata.legalArea,
            procedureType: metadata.procedureType,
            sourceUrl: `https://uitspraken.rechtspraak.nl/details?id=${ecli}`,
            inhoudsindicatie: metadata.inhoudsindicatie,
            source: 'api_search', // Default to API search namespace
            
            // AI-generated fields
            ai_title: aiSummary.title,
            ai_inhoudsindicatie: aiSummary.inhoudsindicatie,
            ai_feiten: aiSummary.feiten,
            ai_geschil: aiSummary.geschil,
            ai_beslissing: aiSummary.beslissing,
            ai_motivering: aiSummary.motivering,
          };
          
          enrichedRecords.push(enrichedRecord);
          console.log(`[${ecli}] ✓ Enriched successfully`);
          
          // Rate limiting between API calls
          if (i < eclis.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error: any) {
          console.error(`[${ecli}] Enrichment failed:`, error.message);
          errors.push({
            ecli,
            error: error.message || 'Unknown error',
          });
        }
      }

      console.log(`[AI Enrich] Completed: ${enrichedRecords.length} enriched, ${errors.length} errors`);
      
      res.json({
        success: true,
        enrichedRecords,
        errors,
        stats: {
          total: eclis.length,
          enriched: enrichedRecords.length,
          failed: errors.length,
        },
      });
    } catch (error: any) {
      console.error('Error in /api/ai/enrich:', error);
      res.status(500).json({ error: error.message || 'AI enrichment failed' });
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
      
      // QUALITY CONTROL: Filter records based on enrichment status
      if (config.records && config.records.length > 0) {
        const isEnriched = (record: any) => {
          return !!(record.ai_title || record.ai_inhoudsindicatie || record.ai_feiten || 
                   record.ai_geschil || record.ai_beslissing || record.ai_motivering);
        };
        
        // NEW: Allow non-enriched records for ECLI_NL namespace only
        if (config.includeNonEnriched) {
          // Split records by source
          const webSearchRecords = config.records.filter((r: any) => r.source === 'web_search');
          const apiSearchRecords = config.records.filter((r: any) => r.source === 'api_search');
          
          // WEB_ECLI: always require enrichment
          const enrichedWebRecords = webSearchRecords.filter(isEnriched);
          const filteredWebCount = webSearchRecords.length - enrichedWebRecords.length;
          
          if (filteredWebCount > 0) {
            console.log(`[Pinecone Export] ${filteredWebCount} niet-verrijkte WEB_ECLI records uitgefilterd (altijd verplicht)`);
          }
          
          // ECLI_NL: allow all records (enriched + non-enriched)
          const enrichedApiCount = apiSearchRecords.filter(isEnriched).length;
          const nonEnrichedApiCount = apiSearchRecords.length - enrichedApiCount;
          
          console.log(`[Pinecone Export] ECLI_NL: ${enrichedApiCount} verrijkt, ${nonEnrichedApiCount} niet-verrijkt (beide toegestaan)`);
          
          // Combine: enriched web records + all API records
          config.records = [...enrichedWebRecords, ...apiSearchRecords];
          
          if (config.records.length === 0) {
            throw new Error('Geen records om te uploaden na filtering.');
          }
        } else {
          // DEFAULT: Only allow enriched records for all namespaces
          const enrichedRecords = config.records.filter(isEnriched);
          const notEnrichedCount = config.records.length - enrichedRecords.length;
          
          if (enrichedRecords.length === 0) {
            throw new Error('Geen AI-verrijkte records gevonden. Gebruik eerst "AI Verrijking Toepassen".');
          }
          
          if (notEnrichedCount > 0) {
            console.log(`[Pinecone Export] ${notEnrichedCount} niet-verrijkte records uitgefilterd`);
          }
          
          // Replace with only enriched records
          config.records = enrichedRecords;
        }
      }
      
      // Set up SSE (Server-Sent Events) for streaming progress
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // NAMESPACE ROUTING: Split records by source and export to correct namespace
      if (config.records && config.records.length > 0) {
        // Validate that all records have a source field
        const recordsWithoutSource = config.records.filter((r: any) => !r.source);
        if (recordsWithoutSource.length > 0) {
          throw new Error(`${recordsWithoutSource.length} records hebben geen 'source' veld. Alle records moeten getagd zijn als 'web_search' of 'api_search'.`);
        }
        
        // DUPLICATE DETECTION: Filter out already uploaded records
        const webSearchRecords = config.records.filter((r: any) => r.source === 'web_search');
        const apiSearchRecords = config.records.filter((r: any) => r.source === 'api_search');
        
        // Check duplicates for web search records (WEB_ECLI namespace)
        const webEclis = webSearchRecords.map((r: any) => r.ecli);
        const webDuplicateCheck = webEclis.length > 0 
          ? await storage.checkDuplicates('WEB_ECLI', webEclis)
          : { total: 0, alreadyProcessed: 0, newEclis: 0, statuses: [] };
        
        // Build map for quick lookup
        const webProcessedSet = new Set(
          webDuplicateCheck.statuses.filter(s => s.isProcessed).map(s => s.ecli)
        );
        const webNewRecords = webSearchRecords.filter((r: any) => !webProcessedSet.has(r.ecli));
        const webDuplicateCount = webSearchRecords.length - webNewRecords.length;
        
        // Check duplicates for API search records (ECLI_NL namespace)
        const apiEclis = apiSearchRecords.map((r: any) => r.ecli);
        const apiDuplicateCheck = apiEclis.length > 0
          ? await storage.checkDuplicates('ECLI_NL', apiEclis)
          : { total: 0, alreadyProcessed: 0, newEclis: 0, statuses: [] };
        
        // Build map for quick lookup
        const apiProcessedSet = new Set(
          apiDuplicateCheck.statuses.filter(s => s.isProcessed).map(s => s.ecli)
        );
        const apiNewRecords = apiSearchRecords.filter((r: any) => !apiProcessedSet.has(r.ecli));
        const apiDuplicateCount = apiSearchRecords.length - apiNewRecords.length;
        
        const totalDuplicates = webDuplicateCount + apiDuplicateCount;
        
        if (totalDuplicates > 0) {
          console.log(`[Pinecone Export] ${totalDuplicates} duplicaten uitgefilterd (${webDuplicateCount} WEB_ECLI, ${apiDuplicateCount} ECLI_NL)`);
        }
        
        // Update config.records to only include new records
        config.records = [...webNewRecords, ...apiNewRecords];
        
        if (config.records.length === 0) {
          throw new Error('Geen nieuwe records om te uploaden. Alle records zijn al geüpload naar Pinecone.');
        }
        
        const unknownSourceRecords = config.records.filter((r: any) => r.source !== 'web_search' && r.source !== 'api_search');
        
        if (unknownSourceRecords.length > 0) {
          console.warn(`[Pinecone Export] WARNING: ${unknownSourceRecords.length} records met onbekende source:`, unknownSourceRecords.map((r: any) => `${r.ecli} (${r.source})`));
        }
        
        console.log(`[Pinecone Export] Web Search records: ${webNewRecords.length} → WEB_ECLI namespace`);
        console.log(`[Pinecone Export] API Search records: ${apiNewRecords.length} → ECLI_NL namespace`);
        
        sendProgress({
          type: 'start',
          message: `Export naar Pinecone gestart (${webNewRecords.length} web search, ${apiNewRecords.length} API search)...`,
          totalRecords: config.records.length,
          webSearchCount: webNewRecords.length,
          apiSearchCount: apiNewRecords.length,
        });
        
        let totalUpserted = 0;
        let allResults: any[] = [];
        
        // Export web search records to WEB_ECLI namespace
        if (webNewRecords.length > 0) {
          sendProgress({
            type: 'namespace_start',
            message: `Exporteren naar WEB_ECLI namespace (${webNewRecords.length} records)...`,
            namespace: 'WEB_ECLI',
          });
          
          try {
            const webResult = await upsertRecordsToPinecone(
              config.indexHost,
              webNewRecords,
              'WEB_ECLI', // Fixed namespace for web search
              config.batchSize,
              (progress) => {
                sendProgress({
                  type: 'progress',
                  namespace: 'WEB_ECLI',
                  ...progress,
                });
              }
            );
            
            totalUpserted += webResult.successCount;
            allResults.push({ namespace: 'WEB_ECLI', ...webResult });
            
            // Mark successfully uploaded ECLIs as processed in WEB_ECLI namespace
            // Use the explicit list of successful ECLIs from the upload result
            // This is accurate even if some records failed mid-batch
            if (webResult.successfulEclis && webResult.successfulEclis.length > 0) {
              const markValues = webResult.successfulEclis.map(ecli => ({ 
                ecli, 
                namespace: 'WEB_ECLI' 
              }));
              
              await db
                .insert(processedEclis)
                .values(markValues)
                .onConflictDoNothing();
              
              console.log(`[Pinecone Export] Marked ${webResult.successfulEclis.length} ECLIs as processed in WEB_ECLI namespace`);
            }
            
            sendProgress({
              type: 'namespace_complete',
              message: `WEB_ECLI namespace voltooid: ${webResult.successCount} records`,
              namespace: 'WEB_ECLI',
              ...webResult,
            });
          } catch (error: any) {
            console.error(`[Pinecone Export] Error uploading to WEB_ECLI namespace:`, error);
            allResults.push({ 
              namespace: 'WEB_ECLI', 
              successCount: 0,
              errorCount: webNewRecords.length,
              errors: [{ ecli: 'batch', error: error.message }]
            });
            sendProgress({
              type: 'namespace_error',
              message: `Fout bij WEB_ECLI namespace: ${error.message}`,
              namespace: 'WEB_ECLI',
            });
            // Continue with next namespace instead of failing entire export
          }
        }
        
        // Export API search records to ECLI_NL namespace
        if (apiNewRecords.length > 0) {
          sendProgress({
            type: 'namespace_start',
            message: `Exporteren naar ECLI_NL namespace (${apiNewRecords.length} records)...`,
            namespace: 'ECLI_NL',
          });
          
          try {
            const apiResult = await upsertRecordsToPinecone(
              config.indexHost,
              apiNewRecords,
              'ECLI_NL', // Fixed namespace for API search
              config.batchSize,
              (progress) => {
                sendProgress({
                  type: 'progress',
                  namespace: 'ECLI_NL',
                  ...progress,
                });
              }
            );
            
            totalUpserted += apiResult.successCount;
            allResults.push({ namespace: 'ECLI_NL', ...apiResult });
            
            // Mark successfully uploaded ECLIs as processed in ECLI_NL namespace
            // Use the explicit list of successful ECLIs from the upload result
            // This is accurate even if some records failed mid-batch
            if (apiResult.successfulEclis && apiResult.successfulEclis.length > 0) {
              const markValues = apiResult.successfulEclis.map(ecli => ({ 
                ecli, 
                namespace: 'ECLI_NL' 
              }));
              
              await db
                .insert(processedEclis)
                .values(markValues)
                .onConflictDoNothing();
              
              console.log(`[Pinecone Export] Marked ${apiResult.successfulEclis.length} ECLIs as processed in ECLI_NL namespace`);
            }
            
            sendProgress({
              type: 'namespace_complete',
              message: `ECLI_NL namespace voltooid: ${apiResult.successCount} records`,
              namespace: 'ECLI_NL',
              ...apiResult,
            });
          } catch (error: any) {
            console.error(`[Pinecone Export] Error uploading to ECLI_NL namespace:`, error);
            allResults.push({ 
              namespace: 'ECLI_NL', 
              successCount: 0,
              errorCount: apiNewRecords.length,
              errors: [{ ecli: 'batch', error: error.message }]
            });
            sendProgress({
              type: 'namespace_error',
              message: `Fout bij ECLI_NL namespace: ${error.message}`,
              namespace: 'ECLI_NL',
            });
            // Continue instead of failing entire export
          }
        }
        
        sendProgress({
          type: 'complete',
          message: `Export voltooid: ${totalUpserted} records naar ${allResults.length} namespaces`,
          totalUpserted,
          namespaces: allResults,
        });
      } else {
        // Fallback for chunks (use original namespace logic)
        // TODO: Chunks don't have a 'source' field, so we can't route them to the correct namespace
        // Solution: Either add 'source' to ChunkedRecord schema, or deprecate chunking altogether
        // For now, chunks use the static namespace provided in config
        console.warn(`[Pinecone Export] Chunk export using static namespace: ${config.namespace}. Namespace routing not supported for chunks.`);
        
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
          totalUpserted: result.successCount,
          namespaces: [{ namespace: config.namespace, ...result }],
        });
      }

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

  // List vectors by ID prefix in Pinecone (useful for debugging)
  app.post('/api/pinecone/list', async (req: Request, res: Response) => {
    try {
      const { prefix, namespace, limit = 100 } = req.body;
      
      if (!prefix) {
        return res.status(400).json({ error: 'Prefix is vereist' });
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
      const ns = index.namespace(namespace || 'laws-current');
      
      // Use listPaginated to get vector IDs by prefix
      const result = await ns.listPaginated({ prefix, limit });
      
      // Get vector IDs (filter out undefined)
      const vectorIds = (result.vectors?.map(v => v.id).filter((id): id is string => id !== undefined)) || [];
      
      // Fetch full records for these IDs to see metadata
      let records = {};
      if (vectorIds.length > 0) {
        const fetchResult = await ns.fetch(vectorIds);
        records = fetchResult.records || {};
      }
      
      res.json({
        namespace: namespace || 'laws-current',
        prefix,
        found: vectorIds.length,
        vectorIds,
        records,
      });
    } catch (error: any) {
      console.error('Error listing from Pinecone:', error);
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

  // Check which ECLIs are already processed (with detailed status per ECLI)
  app.post('/api/processed-eclis/check', async (req: Request, res: Response) => {
    try {
      const { eclis, namespace } = req.body;
      
      if (!Array.isArray(eclis) || eclis.length === 0) {
        return res.status(400).json({ error: 'ECLI lijst is vereist' });
      }
      
      if (!namespace) {
        return res.status(400).json({ error: 'Namespace is vereist' });
      }
      
      // Cap at 200 ECLIs per request for performance
      if (eclis.length > 200) {
        return res.status(400).json({ error: 'Maximaal 200 ECLIs per request' });
      }
      
      // Use storage method for duplicate checking with detailed status
      const result = await storage.checkDuplicates(namespace, eclis);
      
      res.json(result);
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

  // NEW: Web Search Discovery endpoint (replaces old crawler-based discovery)
  app.post('/api/discovery/search', async (req: Request, res: Response) => {
    try {
      const { query, domains, maxResults } = z.object({
        query: z.string().min(1),
        domains: z.array(z.string()).optional(),
        maxResults: z.number().min(1).max(100).default(20),
      }).parse(req.body);
      
      // Set up SSE with proper headers to prevent buffering
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      
      if (req.socket) {
        req.socket.setNoDelay(true);
      }
      
      res.flushHeaders();
      
      const sendProgress = async (progress: any) => {
        console.log('[Discovery SSE]', progress.type, progress.message);
        const data = `data: ${JSON.stringify(progress)}\n\n`;
        res.write(data);
        
        if ('flush' in res && typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
        
        await new Promise(resolve => setImmediate(resolve));
      };
      
      // Import and run discovery service
      const { discoverEclisFromSearch } = await import('./discovery/discovery-service');
      const { eclis, preparedRecords } = await discoverEclisFromSearch(query, {
        domains,
        maxResults,
        onProgress: sendProgress,
      });
      
      console.log(`[Discovery] Found ${eclis.length} ECLIs, prepared ${preparedRecords.length} records`);
      
      // Log first record to debug
      if (preparedRecords.length > 0) {
        console.log('[Discovery] Sample prepared record:', {
          ecli: preparedRecords[0].ecli,
          title: preparedRecords[0].title,
          court: preparedRecords[0].court,
          hasInhoudsindicatie: !!preparedRecords[0].inhoudsindicatie,
          legalArea: preparedRecords[0].legalArea,
        });
      }
      
      // Send completion event with prepared records
      // Note: We send all records at once - frontend has buffered SSE parser to handle large messages
      try {
        const completionData = `data: ${JSON.stringify({
          type: 'discovery_complete',
          message: `Discovery voltooid: ${eclis.length} geldige ECLI's gevonden`,
          eclis,
          preparedRecords,
          totalEclis: eclis.length,
          validEclis: eclis.length,
        })}\n\n`;
        
        console.log(`[Discovery] Sending completion event with ${preparedRecords.length} records (${completionData.length} bytes)`);
        
        res.write(completionData);
        if ('flush' in res && typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
        
        res.end();
      } catch (jsonError: any) {
        console.error('[Discovery] Failed to serialize prepared records:', jsonError);
        
        // Fallback: send error
        const errorData = `data: ${JSON.stringify({
          type: 'error',
          message: `Kon resultaten niet serialiseren: ${jsonError.message}`,
        })}\n\n`;
        res.write(errorData);
        res.end();
      }
    } catch (error: any) {
      console.error('Error in web search discovery:', error);
      
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

  // ============================================================================
  // WETGEVING (Legislation) API Routes
  // ============================================================================

  // Search BWB regulations from KOOP SRU
  app.get('/api/wetgeving/search', async (req: Request, res: Response) => {
    try {
      const { searchBwbRegulations, buildLawTypeQuery } = await import('./koop-sru-service');
      
      const query = req.query.query as string || '*';
      const startRecord = parseInt(req.query.startRecord as string) || 1;
      const maxRecords = Math.min(parseInt(req.query.maxRecords as string) || 100, 200);
      const lawTypes = req.query.lawTypes as string;
      const excludeBES = req.query.excludeBES !== 'false'; // Default true
      
      // Build query with optional law type filter
      let finalQuery = query;
      if (lawTypes) {
        const types = lawTypes.split(',');
        const typeQuery = buildLawTypeQuery(types);
        finalQuery = query === '*' ? typeQuery : `(${query}) AND (${typeQuery})`;
      }
      
      const result = await searchBwbRegulations(finalQuery, startRecord, maxRecords, excludeBES);
      
      // Check duplicates for returned regulations
      const bwbIds = result.regulations.map(r => r.bwbId);
      const duplicateStatus = await storage.checkLawDuplicates(bwbIds);
      
      // Merge duplicate status into regulations
      const regulationsWithStatus = result.regulations.map(reg => {
        const status = duplicateStatus.find(s => s.bwbId === reg.bwbId);
        return {
          ...reg,
          isUploaded: status?.isUploaded || false,
          uploadedAt: status?.uploadedAt,
          chunkCount: status?.chunkCount,
        };
      });
      
      res.json({
        ...result,
        regulations: regulationsWithStatus,
      });
    } catch (error: any) {
      console.error('Error in /api/wetgeving/search:', error);
      res.status(500).json({ 
        error: error.message || 'Fout bij zoeken naar regelingen' 
      });
    }
  });

  // Get uploaded laws list
  app.get('/api/wetgeving/uploaded', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const laws = await storage.getUploadedLaws(limit);
      res.json({ laws });
    } catch (error: any) {
      console.error('Error in /api/wetgeving/uploaded:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Download and process selected regulations
  app.post('/api/wetgeving/download', async (req: Request, res: Response) => {
    try {
      const { 
        searchBwbRegulations, 
        getValidRegulationVersion, 
        downloadLegislationXml, 
        parseLegislationToChunks 
      } = await import('./koop-sru-service');
      const { upsertLawChunksToPinecone } = await import('./pinecone-client');
      
      const { bwbIds, currentOnly = true, forceReupload = false } = req.body;
      
      if (!Array.isArray(bwbIds) || bwbIds.length === 0) {
        return res.status(400).json({ error: 'BWB IDs zijn vereist' });
      }
      
      // Set up SSE for progress streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      
      sendProgress({
        type: 'start',
        message: `Download gestart voor ${bwbIds.length} regelingen...`,
        total: bwbIds.length,
      });
      
      const today = new Date().toISOString().split('T')[0];
      const results: any[] = [];
      const errors: any[] = [];
      let processedCount = 0;
      let totalChunks = 0;
      
      for (const bwbId of bwbIds) {
        try {
          sendProgress({
            type: 'processing',
            message: `Verwerken: ${bwbId}`,
            current: processedCount + 1,
            total: bwbIds.length,
          });
          
          // Get valid version info
          const versionInfo = currentOnly 
            ? await getValidRegulationVersion(bwbId, today)
            : { xmlUrl: `https://wetten.overheid.nl/${bwbId}/xml`, validFrom: today, validTo: null };
          
          if (!versionInfo) {
            errors.push({ bwbId, error: 'Geen geldige versie gevonden' });
            processedCount++;
            continue;
          }
          
          // Download XML
          const { content: xmlContent, hash: xmlHash } = await downloadLegislationXml(bwbId, versionInfo.xmlUrl);
          
          // Check if already uploaded with same hash (skip check if forceReupload is true)
          if (!forceReupload) {
            const isAlreadyUploaded = await storage.isLawVersionUploaded(bwbId, xmlHash);
            if (isAlreadyUploaded) {
              sendProgress({
                type: 'skipped',
                message: `${bwbId} is al geüpload (ongewijzigd)`,
                bwbId,
              });
              processedCount++;
              continue;
            }
          }
          
          // Get title from search
          const searchResult = await searchBwbRegulations(`dcterms.identifier=${bwbId}`, 1, 1);
          const title = searchResult.regulations[0]?.title || `Regeling ${bwbId}`;
          const lawType = searchResult.regulations[0]?.lawType || 'onbekend';
          
          // Parse XML into chunks
          const chunks = parseLegislationToChunks(
            xmlContent,
            bwbId,
            title,
            versionInfo.validFrom,
            versionInfo.validTo
          );
          
          if (chunks.length === 0) {
            errors.push({ bwbId, error: 'Geen chunks kunnen extraheren' });
            processedCount++;
            continue;
          }
          
          sendProgress({
            type: 'chunked',
            message: `${bwbId}: ${chunks.length} chunks geëxtraheerd`,
            bwbId,
            chunkCount: chunks.length,
          });
          
          // Upload to Pinecone
          const namespace = currentOnly ? 'laws-current' : 'laws-historic';
          await upsertLawChunksToPinecone(chunks, PINECONE_INDEX_HOST, namespace);
          
          // Track in database
          await storage.trackUploadedLaw({
            bwbId,
            title,
            lawType,
            validFrom: versionInfo.validFrom,
            validTo: versionInfo.validTo,
            xmlHash,
            chunkCount: chunks.length,
            namespace,
          });
          
          totalChunks += chunks.length;
          results.push({
            bwbId,
            title,
            chunkCount: chunks.length,
            validFrom: versionInfo.validFrom,
            validTo: versionInfo.validTo,
          });
          
          sendProgress({
            type: 'uploaded',
            message: `${bwbId}: ${chunks.length} chunks geüpload naar Pinecone`,
            bwbId,
            chunkCount: chunks.length,
          });
          
        } catch (error: any) {
          console.error(`Error processing ${bwbId}:`, error);
          errors.push({ bwbId, error: error.message });
          
          sendProgress({
            type: 'error',
            message: `Fout bij ${bwbId}: ${error.message}`,
            bwbId,
          });
        }
        
        processedCount++;
        
        // Rate limiting delay
        if (processedCount < bwbIds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      sendProgress({
        type: 'complete',
        message: `Download voltooid: ${results.length} regelingen, ${totalChunks} chunks`,
        results,
        errors,
        totalChunks,
      });
      
      res.end();
    } catch (error: any) {
      console.error('Error in /api/wetgeving/download:', error);
      
      const errorData = `data: ${JSON.stringify({
        type: 'error',
        message: error.message || 'Download failed',
      })}\n\n`;
      res.write(errorData);
      res.end();
    }
  });

  // Check duplicate status for BWB IDs
  app.post('/api/wetgeving/check-duplicates', async (req: Request, res: Response) => {
    try {
      const { bwbIds } = req.body;
      
      if (!Array.isArray(bwbIds)) {
        return res.status(400).json({ error: 'BWB IDs array is vereist' });
      }
      
      const statuses = await storage.checkLawDuplicates(bwbIds);
      
      const uploaded = statuses.filter(s => s.isUploaded).length;
      
      res.json({
        total: bwbIds.length,
        uploaded,
        new: bwbIds.length - uploaded,
        statuses,
      });
    } catch (error: any) {
      console.error('Error in /api/wetgeving/check-duplicates:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // LOKALE REGELGEVING (Local Regulations) API Routes
  // ============================================================================

  // Search local regulations from DRP (CVDR)
  app.get('/api/lokale-regelgeving/search', async (req: Request, res: Response) => {
    try {
      const { searchLocalRegulations, getDutchProvinces } = await import('./drp-service');
      
      const query = req.query.query as string || '*';
      const startRecord = parseInt(req.query.startRecord as string) || 1;
      const maxRecords = Math.min(parseInt(req.query.maxRecords as string) || 50, 100);
      const jurisdictionType = req.query.jurisdictionType as 'provincie' | 'gemeente' | undefined;
      const jurisdiction = req.query.jurisdiction as string | undefined;
      const currentOnly = req.query.currentOnly !== 'false'; // Default true
      
      const result = await searchLocalRegulations(
        query, 
        jurisdictionType, 
        jurisdiction, 
        currentOnly, 
        startRecord, 
        maxRecords
      );
      
      // Check duplicates for returned regulations
      const regulationIds = result.regulations.map(r => r.regulationId);
      const duplicateStatus = await storage.checkLocalRegulationDuplicates(regulationIds);
      
      // Merge duplicate status into regulations
      const regulationsWithStatus = result.regulations.map(reg => {
        const status = duplicateStatus.find(s => s.regulationId === reg.regulationId);
        return {
          ...reg,
          isUploaded: status?.isUploaded || false,
          uploadedAt: status?.uploadedAt,
          chunkCount: status?.chunkCount,
        };
      });
      
      res.json({
        ...result,
        regulations: regulationsWithStatus,
        provinces: getDutchProvinces(),
      });
    } catch (error: any) {
      console.error('Error in /api/lokale-regelgeving/search:', error);
      res.status(500).json({ 
        error: error.message || 'Fout bij zoeken naar lokale regelingen' 
      });
    }
  });

  // Get list of Dutch provinces
  app.get('/api/lokale-regelgeving/provinces', async (req: Request, res: Response) => {
    try {
      const { getDutchProvinces } = await import('./drp-service');
      res.json({ provinces: getDutchProvinces() });
    } catch (error: any) {
      console.error('Error in /api/lokale-regelgeving/provinces:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get uploaded local regulations list
  app.get('/api/lokale-regelgeving/uploaded', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const regulations = await storage.getUploadedLocalRegulations(limit);
      res.json({ regulations });
    } catch (error: any) {
      console.error('Error in /api/lokale-regelgeving/uploaded:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Download and process selected local regulations
  app.post('/api/lokale-regelgeving/download', async (req: Request, res: Response) => {
    try {
      const { 
        downloadLocalRegulationXml, 
        parseLocalRegulationToChunks 
      } = await import('./drp-service');
      const { upsertLocalRegulationChunksToPinecone } = await import('./pinecone-client');
      
      const { regulationIds, regulationData, currentOnly = true, forceReupload = false } = req.body;
      
      if (!Array.isArray(regulationIds) || regulationIds.length === 0) {
        return res.status(400).json({ error: 'Regulation IDs zijn vereist' });
      }
      
      // regulationData is a map of regulationId -> metadata for faster lookup
      const regulationMap = new Map<string, any>();
      if (Array.isArray(regulationData)) {
        regulationData.forEach((reg: any) => {
          regulationMap.set(reg.regulationId, reg);
        });
      }
      
      // Set up SSE for progress streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      
      sendProgress({
        type: 'start',
        message: `Download gestart voor ${regulationIds.length} lokale regelingen...`,
        total: regulationIds.length,
      });
      
      const today = new Date().toISOString().split('T')[0];
      const results: any[] = [];
      const errors: any[] = [];
      let processedCount = 0;
      let totalChunks = 0;
      
      for (const regulationId of regulationIds) {
        try {
          const regData = regulationMap.get(regulationId) || {};
          
          sendProgress({
            type: 'processing',
            message: `Verwerken: ${regulationId}`,
            current: processedCount + 1,
            total: regulationIds.length,
          });
          
          // Download XML - use xmlUrl from metadata if available
          const { content: xmlContent, hash: xmlHash } = await downloadLocalRegulationXml(regulationId, regData.xmlUrl);
          
          // Check if already uploaded with same hash (skip check if forceReupload is true)
          if (!forceReupload) {
            const isAlreadyUploaded = await storage.isLocalRegulationVersionUploaded(regulationId, xmlHash);
            if (isAlreadyUploaded) {
              sendProgress({
                type: 'skipped',
                message: `${regulationId} is al geüpload (ongewijzigd)`,
                regulationId,
              });
              processedCount++;
              continue;
            }
          }
          
          const title = regData.title || `Regeling ${regulationId}`;
          const jurisdiction = regData.jurisdiction || 'Onbekend';
          const jurisdictionType = regData.jurisdictionType || 'gemeente';
          const regulationType = regData.regulationType || 'verordening';
          const versionDate = regData.validFrom || today;
          const isCurrentVersion = regData.isCurrentVersion !== false;
          
          // Parse XML into chunks
          const chunks = parseLocalRegulationToChunks(
            xmlContent,
            regulationId,
            title,
            jurisdiction,
            jurisdictionType,
            regulationType,
            versionDate,
            isCurrentVersion
          );
          
          if (chunks.length === 0) {
            errors.push({ regulationId, error: 'Geen chunks kunnen extraheren' });
            processedCount++;
            continue;
          }
          
          sendProgress({
            type: 'chunked',
            message: `${regulationId}: ${chunks.length} chunks geëxtraheerd`,
            regulationId,
            chunkCount: chunks.length,
          });
          
          // Upload to Pinecone
          const namespace = 'laws-local';
          await upsertLocalRegulationChunksToPinecone(chunks, PINECONE_INDEX_HOST, namespace);
          
          // Track in database
          await storage.trackUploadedLocalRegulation({
            regulationId,
            title,
            jurisdiction,
            jurisdictionType,
            regulationType,
            validFrom: regData.validFrom,
            validTo: regData.validTo,
            versionDate,
            xmlHash,
            chunkCount: chunks.length,
            namespace,
          });
          
          totalChunks += chunks.length;
          results.push({
            regulationId,
            title,
            jurisdiction,
            chunkCount: chunks.length,
          });
          
          sendProgress({
            type: 'uploaded',
            message: `${regulationId}: ${chunks.length} chunks geüpload naar Pinecone`,
            regulationId,
            chunkCount: chunks.length,
          });
          
        } catch (error: any) {
          console.error(`Error processing ${regulationId}:`, error);
          errors.push({ regulationId, error: error.message });
          
          sendProgress({
            type: 'error',
            message: `Fout bij ${regulationId}: ${error.message}`,
            regulationId,
          });
        }
        
        processedCount++;
        
        // Rate limiting delay
        if (processedCount < regulationIds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      sendProgress({
        type: 'complete',
        message: `Download voltooid: ${results.length} regelingen, ${totalChunks} chunks`,
        results,
        errors,
        totalChunks,
      });
      
      res.end();
    } catch (error: any) {
      console.error('Error in /api/lokale-regelgeving/download:', error);
      
      const errorData = `data: ${JSON.stringify({
        type: 'error',
        message: error.message || 'Download failed',
      })}\n\n`;
      res.write(errorData);
      res.end();
    }
  });

  // Check duplicate status for regulation IDs
  app.post('/api/lokale-regelgeving/check-duplicates', async (req: Request, res: Response) => {
    try {
      const { regulationIds } = req.body;
      
      if (!Array.isArray(regulationIds)) {
        return res.status(400).json({ error: 'Regulation IDs array is vereist' });
      }
      
      const statuses = await storage.checkLocalRegulationDuplicates(regulationIds);
      
      const uploaded = statuses.filter(s => s.isUploaded).length;
      
      res.json({
        total: regulationIds.length,
        uploaded,
        new: regulationIds.length - uploaded,
        statuses,
      });
    } catch (error: any) {
      console.error('Error in /api/lokale-regelgeving/check-duplicates:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // OMGEVINGSPLANNEN (Environmental Plans) API Routes - DSO-LV Integration
  // ============================================================================

  // Check DSO API status
  app.get('/api/omgevingsplannen/status', async (req: Request, res: Response) => {
    try {
      const { isDsoApiKeyConfigured } = await import('./dso-service');
      
      res.json({
        configured: isDsoApiKeyConfigured(),
        message: isDsoApiKeyConfigured() 
          ? 'DSO API is geconfigureerd' 
          : 'DSO API-key is niet geconfigureerd. Vraag een key aan via developer.omgevingswet.overheid.nl',
      });
    } catch (error: any) {
      console.error('Error in /api/omgevingsplannen/status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get municipalities list
  app.get('/api/omgevingsplannen/municipalities', async (req: Request, res: Response) => {
    try {
      const { fetchMunicipalities } = await import('./dso-service');
      const municipalities = await fetchMunicipalities();
      res.json({ municipalities });
    } catch (error: any) {
      console.error('Error in /api/omgevingsplannen/municipalities:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get provinces list
  app.get('/api/omgevingsplannen/provinces', async (req: Request, res: Response) => {
    try {
      const { getProvinces } = await import('./dso-service');
      const provinces = getProvinces();
      res.json({ provinces });
    } catch (error: any) {
      console.error('Error in /api/omgevingsplannen/provinces:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get document types
  app.get('/api/omgevingsplannen/document-types', async (req: Request, res: Response) => {
    try {
      const { DSO_DOCUMENT_TYPES, DSO_AUTHORITY_TYPES } = await import('./dso-service');
      res.json({ 
        documentTypes: DSO_DOCUMENT_TYPES,
        authorityTypes: DSO_AUTHORITY_TYPES,
      });
    } catch (error: any) {
      console.error('Error in /api/omgevingsplannen/document-types:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Search omgevingsplannen
  app.get('/api/omgevingsplannen/search', async (req: Request, res: Response) => {
    try {
      const { searchRegelingen, isDsoApiKeyConfigured } = await import('./dso-service');
      
      // Check if API key is configured
      if (!isDsoApiKeyConfigured()) {
        return res.status(503).json({ 
          error: 'DSO API-key is niet geconfigureerd',
          message: 'Vraag een gratis API-key aan via https://developer.omgevingswet.overheid.nl/formulieren/api-key-aanvragen-0/',
          configured: false,
        });
      }
      
      const bevoegdGezag = req.query.bevoegdGezag as string | undefined;
      const typeBevoegdGezag = req.query.typeBevoegdGezag as string | undefined;
      const documentType = req.query.documentType as string | undefined;
      const page = parseInt(req.query.page as string) || 0;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      const geldigOp = req.query.geldigOp as string | undefined;
      
      const result = await searchRegelingen({
        bevoegdGezag,
        typeBevoegdGezag,
        documentType,
        page,
        pageSize,
        geldigOp,
      });
      
      res.json(result);
    } catch (error: any) {
      console.error('Error in /api/omgevingsplannen/search:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get regeling details
  app.get('/api/omgevingsplannen/regeling/:identificatie', async (req: Request, res: Response) => {
    try {
      const { getRegelingDetails, isDsoApiKeyConfigured } = await import('./dso-service');
      
      if (!isDsoApiKeyConfigured()) {
        return res.status(503).json({ 
          error: 'DSO API-key is niet geconfigureerd',
          configured: false,
        });
      }
      
      const { identificatie } = req.params;
      const details = await getRegelingDetails(identificatie);
      
      res.json(details);
    } catch (error: any) {
      console.error('Error in /api/omgevingsplannen/regeling:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Check duplicate status for DSO regeling IDs
  app.post('/api/omgevingsplannen/check-duplicates', async (req: Request, res: Response) => {
    try {
      const { regelingIds } = req.body;
      
      if (!Array.isArray(regelingIds)) {
        return res.status(400).json({ error: 'Regeling IDs array is vereist' });
      }
      
      const statuses = await storage.checkDsoRegelingDuplicates(regelingIds);
      
      const uploaded = statuses.filter(s => s.isUploaded).length;
      
      res.json({
        total: regelingIds.length,
        uploaded,
        new: regelingIds.length - uploaded,
        statuses,
      });
    } catch (error: any) {
      console.error('Error in /api/omgevingsplannen/check-duplicates:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Download and upload DSO regelingen to Pinecone
  app.post('/api/omgevingsplannen/download', async (req: Request, res: Response) => {
    try {
      const { 
        getRegelingTextContent, 
        parseDsoRegelingToChunks,
        isDsoApiKeyConfigured,
        determineBevoegdGezagType
      } = await import('./dso-service');
      const { upsertDsoRegelingChunksToPinecone } = await import('./pinecone-client');
      
      if (!isDsoApiKeyConfigured()) {
        return res.status(503).json({ 
          error: 'DSO API-key is niet geconfigureerd',
          configured: false,
        });
      }
      
      const { regelingIds, regelingData, forceReupload = false } = req.body;
      
      if (!Array.isArray(regelingIds) || regelingIds.length === 0) {
        return res.status(400).json({ error: 'Regeling IDs zijn vereist' });
      }
      
      // regelingData is a map of regelingId -> metadata
      const regelingMap = new Map<string, any>();
      if (Array.isArray(regelingData)) {
        regelingData.forEach((reg: any) => {
          regelingMap.set(reg.identificatie, reg);
        });
      }
      
      // Set up SSE for progress streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      
      sendProgress({
        type: 'start',
        message: `Upload gestart voor ${regelingIds.length} omgevingsdocumenten...`,
        total: regelingIds.length,
      });
      
      const today = new Date().toISOString().split('T')[0];
      const results: any[] = [];
      const errors: any[] = [];
      let processedCount = 0;
      let totalChunks = 0;
      
      for (const regelingId of regelingIds) {
        try {
          const regData = regelingMap.get(regelingId) || {};
          
          sendProgress({
            type: 'processing',
            message: `Verwerken: ${regelingId}`,
            current: processedCount + 1,
            total: regelingIds.length,
          });
          
          // Get text content from DSO API
          const { content: textContent, hash: contentHash, metadata } = await getRegelingTextContent(regelingId);
          
          // Check if already uploaded with same hash (skip check if forceReupload is true)
          if (!forceReupload) {
            const isAlreadyUploaded = await storage.isDsoRegelingVersionUploaded(regelingId, contentHash);
            if (isAlreadyUploaded) {
              sendProgress({
                type: 'skipped',
                message: `${regelingId} is al geüpload (ongewijzigd)`,
                regelingId,
              });
              processedCount++;
              continue;
            }
          }
          
          const title = metadata.officieleTitel || regData.officieleTitel || `Regeling ${regelingId}`;
          const type = metadata.type || regData.type || 'onbekend';
          
          // Get bevoegdGezag from metadata or regData
          // Also try to extract from the title if not available (e.g., "Omgevingsplan gemeente Veendam")
          let bevoegdGezag = metadata.bevoegdGezag?.naam || regData.bevoegdGezag?.naam;
          if (!bevoegdGezag || bevoegdGezag === 'Onbekend') {
            // Try to extract from title
            const titleMatch = title.match(/(?:gemeente|provincie|waterschap)\s+([A-Za-z\s\-']+)/i);
            if (titleMatch) {
              bevoegdGezag = titleMatch[0]; // e.g., "gemeente Veendam"
            } else {
              bevoegdGezag = 'Onbekend';
            }
          }
          
          // Determine bevoegdGezagType from the identificatie code
          const bevoegdGezagType = determineBevoegdGezagType(regelingId);
          
          // Parse text into chunks
          const chunks = parseDsoRegelingToChunks(
            textContent,
            regelingId,
            title,
            type,
            bevoegdGezag,
            bevoegdGezagType,
            today,
            true // isCurrentVersion
          );
          
          if (chunks.length === 0) {
            errors.push({ regelingId, error: 'Geen chunks kunnen extraheren' });
            processedCount++;
            continue;
          }
          
          sendProgress({
            type: 'chunked',
            message: `${regelingId}: ${chunks.length} chunks geëxtraheerd`,
            regelingId,
            chunkCount: chunks.length,
          });
          
          // Upload to Pinecone
          const namespace = 'laws-dso';
          await upsertDsoRegelingChunksToPinecone(chunks, PINECONE_INDEX_HOST, namespace);
          
          // Track in database
          await storage.trackUploadedDsoRegeling({
            regelingId,
            title,
            type,
            bevoegdGezag,
            bevoegdGezagType,
            versionDate: today,
            contentHash,
            chunkCount: chunks.length,
            namespace,
          });
          
          totalChunks += chunks.length;
          results.push({
            regelingId,
            title,
            type,
            bevoegdGezag,
            chunkCount: chunks.length,
          });
          
          sendProgress({
            type: 'uploaded',
            message: `${regelingId}: ${chunks.length} chunks geüpload naar Pinecone`,
            regelingId,
            chunkCount: chunks.length,
          });
          
        } catch (error: any) {
          console.error(`Error processing ${regelingId}:`, error);
          errors.push({ regelingId, error: error.message });
          
          sendProgress({
            type: 'error',
            message: `Fout bij ${regelingId}: ${error.message}`,
            regelingId,
          });
        }
        
        processedCount++;
        
        // Rate limiting delay
        if (processedCount < regelingIds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      sendProgress({
        type: 'complete',
        message: `Upload voltooid: ${results.length} regelingen, ${totalChunks} chunks`,
        results,
        errors,
        totalChunks,
      });
      
      res.end();
    } catch (error: any) {
      console.error('Error in /api/omgevingsplannen/download:', error);
      
      const errorData = `data: ${JSON.stringify({
        type: 'error',
        message: error.message || 'Download failed',
      })}\n\n`;
      res.write(errorData);
      res.end();
    }
  });

  // Health check endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      pineconeConfigured: !!process.env.PINECONE_API_KEY,
      dsoConfigured: !!process.env.DSO_API_KEY,
    });
  });

  // Auto-cleanup old batches every hour (keep batches for 24 hours)
  setInterval(async () => {
    const deletedCount = await storage.cleanupOldBatches(24 * 60 * 60 * 1000); // 24 uur
    if (deletedCount > 0) {
      console.log(`Auto-cleanup: ${deletedCount} oude batches verwijderd (ouder dan 24 uur)`);
    }
  }, 60 * 60 * 1000); // Check elk uur

  const httpServer = createServer(app);
  return httpServer;
}
