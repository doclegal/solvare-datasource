import { z } from "zod";
import { pgTable, serial, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Rechtspraak ECLI record schema
export const ecliRecordSchema = z.object({
  ecli: z.string(),
  title: z.string(),
  court: z.string(),
  decisionDate: z.string(),
  summary: z.string().optional(), // Inhoudsindicatie from <summary> tag
});

export type EcliRecord = z.infer<typeof ecliRecordSchema>;

// Prepared record schema for Pinecone (metadata-only, no full text)
export const preparedRecordSchema = z.object({
  ecli: z.string(),
  title: z.string(),
  court: z.string(),
  decisionDate: z.string(),
  legalArea: z.array(z.string()),
  procedureType: z.string(),
  sourceUrl: z.string(),
  inhoudsindicatie: z.string(), // Official summary from Rechtspraak (required)
});

export type PreparedRecord = z.infer<typeof preparedRecordSchema>;

// Search filters schema - civielrecht with subcategories
export const searchFiltersSchema = z.object({
  batchSize: z.number().default(50),
  datePeriod: z.string().optional().default("all"),
  court: z.string().optional(),
  civilSubcategory: z.string().optional(),
  fullDocumentsOnly: z.boolean().default(false),
  from: z.number().default(0),
});

export type SearchFilters = z.infer<typeof searchFiltersSchema>;

// Chunked record schema for Pinecone with rich metadata
export const chunkedRecordSchema = z.object({
  // Basic identifiers
  ecli: z.string(),
  chunk_id: z.string(),
  section_type: z.enum(['summary', 'claims', 'facts', 'reasoning', 'decision', 'other']),
  title: z.string(),
  source_url: z.string(),
  text: z.string(),
  
  // Civil focus
  is_civil: z.boolean().default(true),
  is_kanton_case: z.boolean().optional(),
  civil_domain: z.string().optional(),
  case_subtype: z.string().optional(),
  procedure_type: z.string().optional(),
  court_level: z.string().optional(),
  court_name: z.string(),
  
  // Date and outcome
  decision_date: z.string(),
  decision_year: z.number().optional(),
  outcome: z.string().optional(),
  
  // Parties and claims
  party_1_type: z.string().optional(),
  party_2_type: z.string().optional(),
  claim_types: z.array(z.string()).optional(),
  burden_of_proof_on: z.string().optional(),
  
  // AI fields
  legal_issue: z.string().optional(),
  key_facts_tags: z.array(z.string()).optional(),
  evidence_themes: z.array(z.string()).optional(),
  risk_profile: z.array(z.string()).optional(),
  statutes_and_articles: z.array(z.string()).optional(),
  
  // LLM chunking metadata (new)
  classification_method: z.enum(['keyword', 'llm', 'keyword-fallback']).optional(),
  classification_confidence: z.number().min(0).max(1).optional(),
  llm_model: z.string().optional(),
  prompt_version: z.string().optional(),
});

export type ChunkedRecord = z.infer<typeof chunkedRecordSchema>;

// Prepared batch schema for server-side storage
export const preparedBatchSchema = z.object({
  batchId: z.string(),
  records: z.array(preparedRecordSchema),
  createdAt: z.date(),
});

export type PreparedBatch = z.infer<typeof preparedBatchSchema>;

// Pinecone export config schema - supports both prepared records and chunks
export const exportConfigSchema = z.object({
  indexHost: z.string(),
  namespace: z.string().optional(),
  batchSize: z.number().default(100),
  records: z.array(preparedRecordSchema).optional(),
  chunks: z.array(chunkedRecordSchema).optional(),
});

export type ExportConfig = z.infer<typeof exportConfigSchema>;

// Database table: Track processed ECLI records
export const processedEclis = pgTable("processed_eclis", {
  id: serial("id").primaryKey(),
  ecli: varchar("ecli", { length: 255 }).notNull().unique(),
  namespace: varchar("namespace", { length: 100 }).notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

// Zod schemas for database operations
export const insertProcessedEcliSchema = createInsertSchema(processedEclis).omit({
  id: true,
  uploadedAt: true,
});

export type InsertProcessedEcli = z.infer<typeof insertProcessedEcliSchema>;
export type ProcessedEcli = typeof processedEclis.$inferSelect;
