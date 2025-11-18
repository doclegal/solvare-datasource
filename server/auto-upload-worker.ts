import { db } from './db';
import { enrichedBatchRecords, processedEclis, type PreparedRecord } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { upsertRecordsToPinecone } from './pinecone-client';

const UPLOAD_BATCH_SIZE = 25;
const PINECONE_INDEX_HOST = 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io';
const NAMESPACE = 'ECLI_NL';

interface UploadProgress {
  type: 'progress' | 'complete' | 'error' | 'start';
  message?: string;
  totalEnriched?: number;
  totalUploaded?: number;
  currentBatch?: number;
  totalBatches?: number;
  successCount?: number;
  errorCount?: number;
}

export class AutoUploadWorker {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private progressCallbacks: Set<(progress: UploadProgress) => void> = new Set();
  private isUploading = false; // Mutex to prevent concurrent uploads

  constructor() {
    // No-op constructor - use addProgressListener for callbacks
  }

  // Register a progress listener (for SSE streaming)
  addProgressListener(callback: (progress: UploadProgress) => void): void {
    this.progressCallbacks.add(callback);
  }

  // Unregister a progress listener
  removeProgressListener(callback: (progress: UploadProgress) => void): void {
    this.progressCallbacks.delete(callback);
  }

  private sendProgress(progress: UploadProgress) {
    // Notify all registered listeners
    this.progressCallbacks.forEach(callback => {
      try {
        callback(progress);
      } catch (error) {
        console.error('[Auto-Upload] Error in progress callback:', error);
      }
    });
    console.log('[Auto-Upload]', progress);
  }

  async start() {
    if (this.isRunning) {
      console.log('[Auto-Upload] Worker already running');
      return;
    }

    this.isRunning = true;
    this.sendProgress({
      type: 'start',
      message: 'Auto-upload worker gestart. Controleert elke 5 minuten op nieuwe verrijkte records...',
    });

    // Immediate first check
    await this.checkAndUpload();

    // Then check every 5 minutes
    this.intervalId = setInterval(async () => {
      await this.checkAndUpload();
    }, 5 * 60 * 1000); // 5 minutes
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.sendProgress({
      type: 'complete',
      message: 'Auto-upload worker gestopt',
    });
  }

  async checkAndUpload(): Promise<void> {
    // Mutex: prevent concurrent uploads
    if (this.isUploading) {
      console.log('[Auto-Upload] Upload already in progress, skipping...');
      return;
    }

    this.isUploading = true;
    
    try {
      // Get all enriched records that haven't been uploaded yet
      const enrichedRecords = await db
        .select()
        .from(enrichedBatchRecords)
        .where(eq(enrichedBatchRecords.isEnriched, true));

      if (enrichedRecords.length === 0) {
        console.log('[Auto-Upload] Geen verrijkte records gevonden');
        return;
      }

      // Get already processed ECLIs
      const processedRecords = await db
        .select({ ecli: processedEclis.ecli })
        .from(processedEclis)
        .where(eq(processedEclis.namespace, NAMESPACE));

      const processedEcliSet = new Set(processedRecords.map(r => r.ecli));

      // Filter out already uploaded records
      const recordsToUpload = enrichedRecords.filter(
        r => !processedEcliSet.has(r.ecli)
      );

      if (recordsToUpload.length === 0) {
        console.log('[Auto-Upload] Alle verrijkte records zijn al geüpload');
        return;
      }

      this.sendProgress({
        type: 'start',
        message: `${recordsToUpload.length} nieuwe verrijkte records gevonden, starten upload...`,
        totalEnriched: recordsToUpload.length,
      });

      // Process in batches of 25
      const totalBatches = Math.ceil(recordsToUpload.length / UPLOAD_BATCH_SIZE);
      let totalSuccessCount = 0;
      let totalErrorCount = 0;

      for (let i = 0; i < totalBatches; i++) {
        const start = i * UPLOAD_BATCH_SIZE;
        const end = Math.min(start + UPLOAD_BATCH_SIZE, recordsToUpload.length);
        const batch = recordsToUpload.slice(start, end);

        this.sendProgress({
          type: 'progress',
          message: `Uploading batch ${i + 1}/${totalBatches}...`,
          currentBatch: i + 1,
          totalBatches,
          totalEnriched: recordsToUpload.length,
        });

        // Parse record data from JSONB
        const preparedRecords: PreparedRecord[] = batch.map(r => r.recordData as PreparedRecord);

        try {
          // Upload to Pinecone
          const result = await upsertRecordsToPinecone(
            PINECONE_INDEX_HOST,
            preparedRecords,
            NAMESPACE,
            UPLOAD_BATCH_SIZE,
            (progress) => {
              this.sendProgress({
                type: 'progress',
                message: `Batch ${i + 1}/${totalBatches}: ${progress.processedRecords}/${progress.totalRecords} records`,
                currentBatch: i + 1,
                totalBatches,
                totalEnriched: recordsToUpload.length,
              });
            }
          );

          totalSuccessCount += result.successCount;
          totalErrorCount += result.errorCount;

          // Mark as processed in database
          const eclis = preparedRecords.map(r => r.ecli);
          await this.markAsProcessed(eclis);

          this.sendProgress({
            type: 'progress',
            message: `✓ Batch ${i + 1}/${totalBatches} voltooid (${result.successCount} succesvol)`,
            currentBatch: i + 1,
            totalBatches,
            successCount: result.successCount,
            errorCount: result.errorCount,
          });

          // Small delay between batches to respect rate limits
          if (i < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error: any) {
          console.error(`[Auto-Upload] Error uploading batch ${i + 1}:`, error);
          totalErrorCount += batch.length;
          
          this.sendProgress({
            type: 'error',
            message: `✗ Batch ${i + 1}/${totalBatches} mislukt: ${error.message}`,
            currentBatch: i + 1,
            totalBatches,
          });
        }
      }

      this.sendProgress({
        type: 'complete',
        message: `Upload voltooid! ${totalSuccessCount} records succesvol geüpload, ${totalErrorCount} fouten`,
        totalUploaded: totalSuccessCount,
        successCount: totalSuccessCount,
        errorCount: totalErrorCount,
      });
    } catch (error: any) {
      console.error('[Auto-Upload] Error in checkAndUpload:', error);
      this.sendProgress({
        type: 'error',
        message: `Fout bij auto-upload: ${error.message}`,
      });
    } finally {
      // Release mutex
      this.isUploading = false;
    }
  }

  private async markAsProcessed(eclis: string[]): Promise<void> {
    if (eclis.length === 0) return;

    try {
      await db.insert(processedEclis).values(
        eclis.map(ecli => ({
          ecli,
          namespace: NAMESPACE,
        }))
      ).onConflictDoNothing();
    } catch (error: any) {
      console.error('[Auto-Upload] Error marking as processed:', error);
    }
  }
}

// SINGLETON INSTANCE - Only one worker runs across the entire process
let globalWorker: AutoUploadWorker | null = null;

export function getGlobalAutoUploadWorker(): AutoUploadWorker {
  if (!globalWorker) {
    globalWorker = new AutoUploadWorker();
    console.log('[Auto-Upload] Created singleton worker instance');
  }
  return globalWorker;
}
