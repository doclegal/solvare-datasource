import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { searchFiltersSchema, exportConfigSchema, preparedRecordSchema, insertProcessedEcliSchema, type PreparedRecord, type PreparedBatch } from "@shared/schema";
import { searchDecisions, fetchDecisionContent } from "./rechtspraak-api";
import { upsertRecordsToPinecone } from "./pinecone-client";
import { createChunksFromRecord } from "./chunking";
import { storage } from "./storage";
import { db, processedEclis } from "./db";
import { inArray, eq } from "drizzle-orm";

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
          const record = await fetchDecisionContent(ecli);
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
          batch = storage.updateBatch(existingBatchId, records);
          console.log(`Updated batch ${existingBatchId} with ${records.length} records`);
        } catch (error: any) {
          // If batch doesn't exist, create new one
          batch = storage.createBatch(records);
          console.log(`Batch ${existingBatchId} not found, created new batch ${batch.batchId} with ${records.length} records`);
        }
      } else {
        batch = storage.createBatch(records);
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
      const batch = storage.getBatch(batchId);
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
      const batch = storage.getBatch(batchId);
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

  // Cleanup batch (manual deletion)
  app.delete('/api/rechtspraak/batch/:batchId', (req: Request, res: Response) => {
    const { batchId } = req.params;
    storage.deleteBatch(batchId);
    res.json({ success: true, message: 'Batch verwijderd' });
  });

  // Cleanup old batches (manual trigger)
  app.post('/api/rechtspraak/cleanup-batches', (req: Request, res: Response) => {
    const maxAgeMs = req.body.maxAgeMs || 30 * 60 * 1000; // Default: 30 minutes
    const deletedCount = storage.cleanupOldBatches(maxAgeMs);
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
      
      // Query database for already processed ECLIs in this namespace
      const processed = await db
        .select({ ecli: processedEclis.ecli })
        .from(processedEclis)
        .where(
          inArray(processedEclis.ecli, eclis)
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

  // Health check endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      pineconeConfigured: !!process.env.PINECONE_API_KEY,
    });
  });

  // Auto-cleanup old batches every 10 minutes
  setInterval(() => {
    const deletedCount = storage.cleanupOldBatches(30 * 60 * 1000);
    if (deletedCount > 0) {
      console.log(`Auto-cleanup: ${deletedCount} oude batches verwijderd`);
    }
  }, 10 * 60 * 1000);

  const httpServer = createServer(app);
  return httpServer;
}
