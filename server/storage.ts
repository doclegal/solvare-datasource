import type { PreparedRecord, PreparedBatch, CheckDuplicatesResponse, EcliStatus, LawUploadStatus, InsertUploadedLaw, LocalRegulationUploadStatus, InsertUploadedLocalRegulation, InsertUploadedDsoRegeling } from '@shared/schema';
import { enrichedBatches, enrichedBatchRecords, processedEclis, uploadedLaws, uploadedLocalRegulations, uploadedDsoRegelingen } from '@shared/schema';
import { randomUUID } from 'crypto';
import { db } from './db';
import { eq, and, sql, inArray, or } from 'drizzle-orm';

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

  // ============================================================================
  // WETGEVING (Legislation) Storage Methods
  // ============================================================================

  /**
   * Check which laws have already been uploaded to Pinecone
   */
  async checkLawDuplicates(bwbIds: string[]): Promise<LawUploadStatus[]> {
    if (bwbIds.length === 0) {
      return [];
    }

    const uploadedRecords = await db
      .select()
      .from(uploadedLaws)
      .where(inArray(uploadedLaws.bwbId, bwbIds));

    const uploadedMap = new Map(
      uploadedRecords.map(record => [record.bwbId, record])
    );

    return bwbIds.map(bwbId => {
      const uploaded = uploadedMap.get(bwbId);
      return {
        bwbId,
        isUploaded: !!uploaded,
        uploadedAt: uploaded?.uploadedAt?.toISOString(),
        chunkCount: uploaded?.chunkCount || undefined,
      };
    });
  }

  /**
   * Check if a specific law version has been uploaded (by hash)
   */
  async isLawVersionUploaded(bwbId: string, xmlHash: string): Promise<boolean> {
    const existing = await db
      .select()
      .from(uploadedLaws)
      .where(
        and(
          eq(uploadedLaws.bwbId, bwbId),
          eq(uploadedLaws.xmlHash, xmlHash)
        )
      )
      .limit(1);

    return existing.length > 0;
  }

  /**
   * Track an uploaded law in the database
   */
  async trackUploadedLaw(law: InsertUploadedLaw): Promise<void> {
    await db
      .insert(uploadedLaws)
      .values(law)
      .onConflictDoUpdate({
        target: [uploadedLaws.bwbId, uploadedLaws.validFrom, uploadedLaws.validTo],
        set: {
          title: law.title,
          lawType: law.lawType,
          xmlHash: law.xmlHash,
          chunkCount: law.chunkCount,
          namespace: law.namespace,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Get all uploaded laws for display
   */
  async getUploadedLaws(limit: number = 100): Promise<Array<{
    bwbId: string;
    title: string;
    lawType: string | null;
    chunkCount: number;
    uploadedAt: Date;
  }>> {
    const laws = await db
      .select({
        bwbId: uploadedLaws.bwbId,
        title: uploadedLaws.title,
        lawType: uploadedLaws.lawType,
        chunkCount: uploadedLaws.chunkCount,
        uploadedAt: uploadedLaws.uploadedAt,
      })
      .from(uploadedLaws)
      .orderBy(sql`${uploadedLaws.uploadedAt} DESC`)
      .limit(limit);

    return laws;
  }

  /**
   * Delete law tracking record (for re-upload)
   */
  async deleteLawRecord(bwbId: string): Promise<void> {
    await db
      .delete(uploadedLaws)
      .where(eq(uploadedLaws.bwbId, bwbId));
  }

  // ============================================================================
  // LOKALE REGELGEVING (Local Regulations) Storage Methods
  // ============================================================================

  /**
   * Check which local regulations have already been uploaded to Pinecone
   */
  async checkLocalRegulationDuplicates(regulationIds: string[]): Promise<LocalRegulationUploadStatus[]> {
    if (regulationIds.length === 0) {
      return [];
    }

    const uploadedRecords = await db
      .select()
      .from(uploadedLocalRegulations)
      .where(inArray(uploadedLocalRegulations.regulationId, regulationIds));

    const uploadedMap = new Map(
      uploadedRecords.map(record => [record.regulationId, record])
    );

    return regulationIds.map(regulationId => {
      const uploaded = uploadedMap.get(regulationId);
      return {
        regulationId,
        isUploaded: !!uploaded,
        uploadedAt: uploaded?.uploadedAt?.toISOString(),
        chunkCount: uploaded?.chunkCount || undefined,
      };
    });
  }

  /**
   * Check if a specific local regulation version has been uploaded (by hash)
   */
  async isLocalRegulationVersionUploaded(regulationId: string, xmlHash: string): Promise<boolean> {
    const existing = await db
      .select()
      .from(uploadedLocalRegulations)
      .where(
        and(
          eq(uploadedLocalRegulations.regulationId, regulationId),
          eq(uploadedLocalRegulations.xmlHash, xmlHash)
        )
      )
      .limit(1);

    return existing.length > 0;
  }

  /**
   * Track an uploaded local regulation in the database
   */
  async trackUploadedLocalRegulation(regulation: InsertUploadedLocalRegulation): Promise<void> {
    await db
      .insert(uploadedLocalRegulations)
      .values(regulation)
      .onConflictDoUpdate({
        target: [uploadedLocalRegulations.regulationId, uploadedLocalRegulations.versionDate],
        set: {
          title: regulation.title,
          jurisdiction: regulation.jurisdiction,
          jurisdictionType: regulation.jurisdictionType,
          regulationType: regulation.regulationType,
          xmlHash: regulation.xmlHash,
          chunkCount: regulation.chunkCount,
          namespace: regulation.namespace,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Get all uploaded local regulations for display
   */
  async getUploadedLocalRegulations(limit: number = 100): Promise<Array<{
    regulationId: string;
    title: string;
    jurisdiction: string;
    jurisdictionType: string;
    regulationType: string | null;
    chunkCount: number;
    uploadedAt: Date;
  }>> {
    const regulations = await db
      .select({
        regulationId: uploadedLocalRegulations.regulationId,
        title: uploadedLocalRegulations.title,
        jurisdiction: uploadedLocalRegulations.jurisdiction,
        jurisdictionType: uploadedLocalRegulations.jurisdictionType,
        regulationType: uploadedLocalRegulations.regulationType,
        chunkCount: uploadedLocalRegulations.chunkCount,
        uploadedAt: uploadedLocalRegulations.uploadedAt,
      })
      .from(uploadedLocalRegulations)
      .orderBy(sql`${uploadedLocalRegulations.uploadedAt} DESC`)
      .limit(limit);

    return regulations;
  }

  /**
   * Delete local regulation tracking record (for re-upload)
   */
  async deleteLocalRegulationRecord(regulationId: string): Promise<void> {
    await db
      .delete(uploadedLocalRegulations)
      .where(eq(uploadedLocalRegulations.regulationId, regulationId));
  }

  // ============================================================================
  // DSO OMGEVINGSPLANNEN - Storage Functions
  // ============================================================================

  /**
   * Check if a DSO regeling version has been uploaded to Pinecone
   */
  async isDsoRegelingVersionUploaded(regelingId: string, contentHash: string): Promise<boolean> {
    const existing = await db
      .select()
      .from(uploadedDsoRegelingen)
      .where(
        and(
          eq(uploadedDsoRegelingen.regelingId, regelingId),
          eq(uploadedDsoRegelingen.contentHash, contentHash)
        )
      )
      .limit(1);

    return existing.length > 0;
  }

  /**
   * Track an uploaded DSO regeling in the database
   */
  async trackUploadedDsoRegeling(regeling: InsertUploadedDsoRegeling): Promise<void> {
    await db
      .insert(uploadedDsoRegelingen)
      .values(regeling)
      .onConflictDoUpdate({
        target: [uploadedDsoRegelingen.regelingId, uploadedDsoRegelingen.versionDate],
        set: {
          title: regeling.title,
          type: regeling.type,
          bevoegdGezag: regeling.bevoegdGezag,
          bevoegdGezagType: regeling.bevoegdGezagType,
          contentHash: regeling.contentHash,
          chunkCount: regeling.chunkCount,
          namespace: regeling.namespace,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Check duplicate status for DSO regeling IDs
   */
  async checkDsoRegelingDuplicates(regelingIds: string[]): Promise<Array<{
    regelingId: string;
    isUploaded: boolean;
    uploadedAt?: string;
    chunkCount?: number;
  }>> {
    const existing = await db
      .select({
        regelingId: uploadedDsoRegelingen.regelingId,
        uploadedAt: uploadedDsoRegelingen.uploadedAt,
        chunkCount: uploadedDsoRegelingen.chunkCount,
      })
      .from(uploadedDsoRegelingen)
      .where(inArray(uploadedDsoRegelingen.regelingId, regelingIds));

    const existingMap = new Map(
      existing.map(e => [e.regelingId, e])
    );

    return regelingIds.map(regelingId => {
      const found = existingMap.get(regelingId);
      return {
        regelingId,
        isUploaded: !!found,
        uploadedAt: found?.uploadedAt?.toISOString(),
        chunkCount: found?.chunkCount,
      };
    });
  }

  /**
   * Get all uploaded DSO regelingen for display
   */
  async getUploadedDsoRegelingen(limit: number = 100): Promise<Array<{
    regelingId: string;
    title: string;
    type: string;
    bevoegdGezag: string;
    bevoegdGezagType: string;
    chunkCount: number;
    uploadedAt: Date;
  }>> {
    const regelingen = await db
      .select({
        regelingId: uploadedDsoRegelingen.regelingId,
        title: uploadedDsoRegelingen.title,
        type: uploadedDsoRegelingen.type,
        bevoegdGezag: uploadedDsoRegelingen.bevoegdGezag,
        bevoegdGezagType: uploadedDsoRegelingen.bevoegdGezagType,
        chunkCount: uploadedDsoRegelingen.chunkCount,
        uploadedAt: uploadedDsoRegelingen.uploadedAt,
      })
      .from(uploadedDsoRegelingen)
      .orderBy(sql`${uploadedDsoRegelingen.uploadedAt} DESC`)
      .limit(limit);

    return regelingen;
  }
}

export const storage = new PgStorage();
