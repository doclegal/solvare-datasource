import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { searchFiltersSchema, exportConfigSchema } from "@shared/schema";
import { searchDecisions, fetchDecisionContent } from "./rechtspraak-api";
import { upsertRecordsToPinecone } from "./pinecone-client";

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
        total: eclis.length,
        successful: results.length,
        failed: errors.length,
      });
    } catch (error: any) {
      console.error('Error in /api/rechtspraak/content:', error);
      res.status(500).json({ 
        error: error.message || 'Fout bij ophalen van inhoud' 
      });
    }
  });

  // Export to Pinecone (streaming progress)
  app.post('/api/pinecone/export', async (req: Request, res: Response) => {
    try {
      const config = exportConfigSchema.parse(req.body);
      
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
        totalRecords: config.records.length,
      });

      const result = await upsertRecordsToPinecone(
        config.indexHost,
        config.records,
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

  // Health check endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      pineconeConfigured: !!process.env.PINECONE_API_KEY,
    });
  });

  const httpServer = createServer(app);
  return httpServer;
}
