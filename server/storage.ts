import type { PreparedRecord, PreparedBatch, CheckDuplicatesResponse, EcliStatus } from '@shared/schema';
import { enrichedBatches, enrichedBatchRecords, processedEclis } from '@shared/schema';
import { randomUUID } from 'crypto';
import { db } from './db';
import { eq, and, sql, inArray } from 'drizzle-orm';

// Storage interface for prepared record batches
// Supports both in-memory (fast, temporary) and PostgreSQL (persistent) storage
export interface IStorage {
  // Batch management
  createBatch(records: PreparedRecord[]): Promise<PreparedBatch>;
  updateBatch(batchId: string, records: PreparedRecord[]): Promise<PreparedBatch>;
  getBatch(batchId: string): Promise<PreparedBatch | undefined>;
  listBatches(limit?: number): Promise<Array<{ batchId: string; totalRecords: number; enrichedRecords: number; createdAt: Date }>>;
  deleteBatch(batchId: string): Promise<void>;
  cleanupOldBatches(maxAgeMs: number): Promise<number>;
  
  // Incremental enrichment methods (PostgreSQL-only)
  upsertEnrichedRecord(batchId: string, record: PreparedRecord): Promise<void>;
  
  // Duplicate checking
  checkDuplicates(namespace: string, eclis: string[]): Promise<CheckDuplicatesResponse>;
}

export class MemStorage implements IStorage {
  private batches: Map<string, PreparedBatch> = new Map();
  
  constructor() {}
  
  async createBatch(records: PreparedRecord[]): Promise<PreparedBatch> {
    const batch: PreparedBatch = {
      batchId: randomUUID(),
      records,
      createdAt: new Date(),
    };
    
    this.batches.set(batch.batchId, batch);
    return batch;
  }
  
  async updateBatch(batchId: string, records: PreparedRecord[]): Promise<PreparedBatch> {
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
  
  async getBatch(batchId: string): Promise<PreparedBatch | undefined> {
    return this.batches.get(batchId);
  }
  
  async listBatches(limit: number = 20): Promise<Array<{ batchId: string; totalRecords: number; enrichedRecords: number; createdAt: Date }>> {
    const allBatches = Array.from(this.batches.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
    
    return allBatches.map(batch => ({
      batchId: batch.batchId,
      totalRecords: batch.records.length,
      enrichedRecords: batch.records.filter(r => r.ai_title || r.ai_inhoudsindicatie).length,
      createdAt: batch.createdAt,
    }));
  }
  
  async deleteBatch(batchId: string): Promise<void> {
    this.batches.delete(batchId);
  }
  
  async cleanupOldBatches(maxAgeMs: number = 30 * 60 * 1000): Promise<number> {
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
  
  async upsertEnrichedRecord(batchId: string, record: PreparedRecord): Promise<void> {
    // MemStorage doesn't support incremental updates
    throw new Error('MemStorage does not support incremental enrichment updates');
  }
  
  async checkDuplicates(namespace: string, eclis: string[]): Promise<CheckDuplicatesResponse> {
    // MemStorage doesn't have persistent duplicate tracking
    // Return all as new ECLIs
    const statuses: EcliStatus[] = eclis.map(ecli => ({
      ecli,
      isProcessed: false,
    }));
    
    return {
      total: eclis.length,
      alreadyProcessed: 0,
      newEclis: eclis.length,
      statuses,
    };
  }
}

// PostgreSQL-backed storage for enriched batches (survives workflow restarts)
export class PgStorage implements IStorage {
  async createBatch(records: PreparedRecord[]): Promise<PreparedBatch> {
    const batchId = randomUUID();
    
    // Insert batch metadata and get the actual createdAt timestamp from database
    const [insertedBatch] = await db.insert(enrichedBatches).values({
      batchId,
      totalRecords: records.length,
      enrichedRecords: 0,
      failedRecords: 0,
    }).returning({ createdAt: enrichedBatches.createdAt });
    
    // Safety: ensure we got a valid timestamp from the database
    if (!insertedBatch || !insertedBatch.createdAt) {
      throw new Error('Failed to create batch: database did not return createdAt timestamp');
    }
    
    // Insert baseline records (immutable snapshot)
    const recordRows = records.map(record => ({
      batchId,
      ecli: record.ecli,
      recordData: record as unknown as Record<string, unknown>,
      isEnriched: false,
    }));
    
    await db.insert(enrichedBatchRecords).values(recordRows);
    
    return {
      batchId,
      records,
      createdAt: insertedBatch.createdAt, // Use actual DB timestamp for accurate cleanup
    };
  }
  
  async updateBatch(batchId: string, records: PreparedRecord[]): Promise<PreparedBatch> {
    // For PgStorage, use upsertEnrichedRecord instead for incremental updates
    throw new Error('Use upsertEnrichedRecord for incremental updates in PgStorage');
  }
  
  async getBatch(batchId: string): Promise<PreparedBatch | undefined> {
    const batchMeta = await db
      .select()
      .from(enrichedBatches)
      .where(eq(enrichedBatches.batchId, batchId))
      .limit(1);
    
    if (batchMeta.length === 0) {
      return undefined;
    }
    
    const recordRows = await db
      .select()
      .from(enrichedBatchRecords)
      .where(eq(enrichedBatchRecords.batchId, batchId));
    
    const records = recordRows.map(row => row.recordData as unknown as PreparedRecord);
    
    return {
      batchId,
      records,
      createdAt: batchMeta[0].createdAt,
    };
  }
  
  async listBatches(limit: number = 20): Promise<Array<{ batchId: string; totalRecords: number; enrichedRecords: number; createdAt: Date }>> {
    const batches = await db
      .select()
      .from(enrichedBatches)
      .orderBy(sql`${enrichedBatches.createdAt} DESC`)
      .limit(limit);
    
    return batches.map(batch => ({
      batchId: batch.batchId,
      totalRecords: batch.totalRecords,
      enrichedRecords: batch.enrichedRecords,
      createdAt: batch.createdAt,
    }));
  }
  
  async deleteBatch(batchId: string): Promise<void> {
    await db.delete(enrichedBatchRecords).where(eq(enrichedBatchRecords.batchId, batchId));
    await db.delete(enrichedBatches).where(eq(enrichedBatches.batchId, batchId));
  }
  
  async cleanupOldBatches(maxAgeMs: number): Promise<number> {
    const cutoffDate = new Date(Date.now() - maxAgeMs);
    
    const oldBatches = await db
      .select()
      .from(enrichedBatches)
      .where(sql`${enrichedBatches.createdAt} < ${cutoffDate}`);
    
    for (const batch of oldBatches) {
      await this.deleteBatch(batch.batchId);
    }
    
    return oldBatches.length;
  }
  
  async upsertEnrichedRecord(batchId: string, record: PreparedRecord): Promise<void> {
    // Check if record has AI fields (enriched)
    const hasAiFields = !!(
      record.ai_inhoudsindicatie ||
      record.ai_feiten ||
      record.ai_geschil ||
      record.ai_beslissing ||
      record.ai_motivering
    );
    
    // Upsert record with enriched data
    await db
      .insert(enrichedBatchRecords)
      .values({
        batchId,
        ecli: record.ecli,
        recordData: record as unknown as Record<string, unknown>,
        isEnriched: hasAiFields,
      })
      .onConflictDoUpdate({
        target: [enrichedBatchRecords.batchId, enrichedBatchRecords.ecli],
        set: {
          recordData: record as unknown as Record<string, unknown>,
          isEnriched: hasAiFields,
          updatedAt: new Date(),
        },
      });
    
    // Update batch metadata
    await db
      .update(enrichedBatches)
      .set({
        enrichedRecords: sql`${enrichedBatches.enrichedRecords} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(enrichedBatches.batchId, batchId));
  }
  
  async checkDuplicates(namespace: string, eclis: string[]): Promise<CheckDuplicatesResponse> {
    if (eclis.length === 0) {
      return {
        total: 0,
        alreadyProcessed: 0,
        newEclis: 0,
        statuses: [],
      };
    }
    
    // Query processed_eclis table for this namespace
    const processedRecords = await db
      .select()
      .from(processedEclis)
      .where(
        and(
          eq(processedEclis.namespace, namespace),
          inArray(processedEclis.ecli, eclis)
        )
      );
    
    // Create map for quick lookup
    const processedMap = new Map(
      processedRecords.map(record => [record.ecli, record.uploadedAt])
    );
    
    // Build status for each ECLI
    const statuses: EcliStatus[] = eclis.map(ecli => {
      const uploadedAt = processedMap.get(ecli);
      return {
        ecli,
        isProcessed: !!uploadedAt,
        uploadedAt: uploadedAt?.toISOString(),
      };
    });
    
    const alreadyProcessed = statuses.filter(s => s.isProcessed).length;
    
    return {
      total: eclis.length,
      alreadyProcessed,
      newEclis: eclis.length - alreadyProcessed,
      statuses,
    };
  }
}

export const storage = new PgStorage();
