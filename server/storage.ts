import type { PreparedRecord, PreparedBatch } from '@shared/schema';
import { randomUUID } from 'crypto';

// In-memory storage for prepared record batches
// Prevents HTTP 413 errors by storing large payloads server-side
export interface IStorage {
  // Batch management
  createBatch(records: PreparedRecord[]): PreparedBatch;
  updateBatch(batchId: string, records: PreparedRecord[]): PreparedBatch;
  getBatch(batchId: string): PreparedBatch | undefined;
  deleteBatch(batchId: string): void;
  cleanupOldBatches(maxAgeMs: number): number;
}

export class MemStorage implements IStorage {
  private batches: Map<string, PreparedBatch> = new Map();
  
  constructor() {}
  
  createBatch(records: PreparedRecord[]): PreparedBatch {
    const batch: PreparedBatch = {
      batchId: randomUUID(),
      records,
      createdAt: new Date(),
    };
    
    this.batches.set(batch.batchId, batch);
    return batch;
  }
  
  updateBatch(batchId: string, records: PreparedRecord[]): PreparedBatch {
    const existingBatch = this.batches.get(batchId);
    if (!existingBatch) {
      throw new Error(`Batch ${batchId} niet gevonden`);
    }
    
    const updatedBatch: PreparedBatch = {
      ...existingBatch,
      records,
      createdAt: new Date(), // Reset TTL on update
    };
    
    this.batches.set(batchId, updatedBatch);
    return updatedBatch;
  }
  
  getBatch(batchId: string): PreparedBatch | undefined {
    return this.batches.get(batchId);
  }
  
  deleteBatch(batchId: string): void {
    this.batches.delete(batchId);
  }
  
  cleanupOldBatches(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let deletedCount = 0;
    
    for (const [batchId, batch] of Array.from(this.batches.entries())) {
      const age = now - batch.createdAt.getTime();
      if (age > maxAgeMs) {
        this.batches.delete(batchId);
        deletedCount++;
      }
    }
    
    return deletedCount;
  }
}

export const storage = new MemStorage();
