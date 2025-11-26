import { z } from "zod";
import { pgTable, serial, varchar, timestamp, uniqueIndex, index, text, jsonb, integer, boolean } from "drizzle-orm/pg-core";
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
  courtLevel: z.enum(['Hoge Raad', 'Gerechtshof', 'Rechtbank', 'Overig']).optional(),
  decisionDate: z.string(),
  legalArea: z.array(z.string()),
  procedureType: z.string(),
  sourceUrl: z.string(),
  inhoudsindicatie: z.string(), // Official summary from Rechtspraak (required)
  fullText: z.string().optional(), // Full text of judgment (for AI enrichment)
  
  // Source tracking: determines Pinecone namespace
  // web_search → WEB_ECLI namespace
  // api_search → ECLI_NL namespace
  source: z.enum(['web_search', 'api_search']).default('api_search'),
  
  // AI-generated summary sections (generated from full text)
  ai_title: z.string().optional(), // AI-generated title (fallback when title is empty)
  ai_inhoudsindicatie: z.string().optional(),
  ai_feiten: z.string().optional(),
  ai_geschil: z.string().optional(),
  ai_beslissing: z.string().optional(),
  ai_motivering: z.string().optional(),
  
  // Duplicate detection fields (added by frontend useDuplicateCheck hook)
  isDuplicate: z.boolean().optional(),
  uploadedAt: z.string().optional(),
});

export type PreparedRecord = z.infer<typeof preparedRecordSchema>;

// Search filters schema - civielrecht with subcategories
export const searchFiltersSchema = z.object({
  batchSize: z.number().default(50),
  datePeriod: z.string().optional().default("all"),
  // NEW: Year/Month specific filtering (takes precedence over datePeriod)
  year: z.number().optional(), // e.g., 2024
  month: z.number().optional(), // 1-12 (optional, if not set = whole year)
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
  includeNonEnriched: z.boolean().optional().default(false), // NEW: Allow non-enriched ECLI_NL records
});

export type ExportConfig = z.infer<typeof exportConfigSchema>;

// Database table: Track processed ECLI records
export const processedEclis = pgTable("processed_eclis", {
  id: serial("id").primaryKey(),
  ecli: varchar("ecli", { length: 255 }).notNull(),
  namespace: varchar("namespace", { length: 100 }).notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
}, (table) => ({
  // Composite unique index: same ECLI can exist in different namespaces
  uniqueEcliNamespace: uniqueIndex("unique_ecli_namespace").on(table.ecli, table.namespace),
  // Index on namespace for faster check queries
  namespaceIdx: index("namespace_idx").on(table.namespace),
}));

// Zod schemas for database operations
export const insertProcessedEcliSchema = createInsertSchema(processedEclis).omit({
  id: true,
  uploadedAt: true,
});

export type InsertProcessedEcli = z.infer<typeof insertProcessedEcliSchema>;
export type ProcessedEcli = typeof processedEclis.$inferSelect;

// Duplicate check request/response schemas
export const checkDuplicatesRequestSchema = z.object({
  namespace: z.string(),
  eclis: z.array(z.string()).max(200), // Cap at 200 ECLIs per request
});

export const ecliStatusSchema = z.object({
  ecli: z.string(),
  isProcessed: z.boolean(),
  uploadedAt: z.string().optional(), // ISO timestamp
});

export const checkDuplicatesResponseSchema = z.object({
  total: z.number(),
  alreadyProcessed: z.number(),
  newEclis: z.number(),
  statuses: z.array(ecliStatusSchema),
});

export type CheckDuplicatesRequest = z.infer<typeof checkDuplicatesRequestSchema>;
export type EcliStatus = z.infer<typeof ecliStatusSchema>;
export type CheckDuplicatesResponse = z.infer<typeof checkDuplicatesResponseSchema>;

// Database table: Enriched batches (persistent storage for AI-enriched records)
export const enrichedBatches = pgTable("enriched_batches", {
  id: serial("id").primaryKey(),
  batchId: varchar("batch_id", { length: 255 }).notNull().unique(),
  totalRecords: integer("total_records").notNull(),
  enrichedRecords: integer("enriched_records").notNull().default(0),
  failedRecords: integer("failed_records").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  batchIdIdx: index("batch_id_idx").on(table.batchId),
}));

// Database table: Individual enriched records within a batch
export const enrichedBatchRecords = pgTable("enriched_batch_records", {
  id: serial("id").primaryKey(),
  batchId: varchar("batch_id", { length: 255 }).notNull(),
  ecli: varchar("ecli", { length: 255 }).notNull(),
  recordData: jsonb("record_data").notNull(), // Full PreparedRecord as JSON
  isEnriched: boolean("is_enriched").notNull().default(false), // false = baseline, true = enriched
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueBatchEcli: uniqueIndex("unique_batch_ecli").on(table.batchId, table.ecli),
  batchIdIdx: index("batch_id_idx_records").on(table.batchId),
}));

// Zod schemas for enriched batches
export const insertEnrichedBatchSchema = createInsertSchema(enrichedBatches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEnrichedBatchRecordSchema = createInsertSchema(enrichedBatchRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEnrichedBatch = z.infer<typeof insertEnrichedBatchSchema>;
export type EnrichedBatch = typeof enrichedBatches.$inferSelect;
export type InsertEnrichedBatchRecord = z.infer<typeof insertEnrichedBatchRecordSchema>;
export type EnrichedBatchRecord = typeof enrichedBatchRecords.$inferSelect;

// Database table: Discovery sources (legal websites/domains to search)
export const discoverySources = pgTable("discovery_sources", {
  id: serial("id").primaryKey(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  label: varchar("label", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }),
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  domainIdx: index("discovery_domain_idx").on(table.domain),
}));

// Database table: Discovery search runs (tracks API queries and pagination)
export const discoverySearchRuns = pgTable("discovery_search_runs", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(), // Search query (e.g., "ECLI:NL: huurrecht")
  apiProvider: varchar("api_provider", { length: 50 }).notNull().default("serpapi"),
  sourceId: integer("source_id"), // Optional: specific source to search
  resultOffset: integer("result_offset").notNull().default(0),
  pageSize: integer("page_size").notNull().default(20),
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, running, completed, failed
  resultsFound: integer("results_found").default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  statusIdx: index("discovery_status_idx").on(table.status),
}));

// Database table: Discovery results (extracted ECLIs from search)
export const discoveryResults = pgTable("discovery_results", {
  id: serial("id").primaryKey(),
  searchRunId: integer("search_run_id").notNull(),
  sourceUrl: text("source_url").notNull(), // URL where ECLI was found
  ecli: varchar("ecli", { length: 255 }).notNull(),
  court: varchar("court", { length: 255 }),
  occurrencesCount: integer("occurrences_count").notNull().default(1), // How many times found
  isReviewed: boolean("is_reviewed").notNull().default(false),
  extractedAt: timestamp("extracted_at").notNull().defaultNow(),
}, (table) => ({
  uniqueEcliSource: uniqueIndex("unique_ecli_source").on(table.ecli, table.sourceUrl),
  ecliIdx: index("discovery_ecli_idx").on(table.ecli),
  searchRunIdx: index("discovery_search_run_idx").on(table.searchRunId),
}));

// Zod schemas for discovery operations
export const insertDiscoverySourceSchema = createInsertSchema(discoverySources).omit({
  id: true,
  createdAt: true,
});

export const insertDiscoverySearchRunSchema = createInsertSchema(discoverySearchRuns).omit({
  id: true,
  createdAt: true,
});

export const insertDiscoveryResultSchema = createInsertSchema(discoveryResults).omit({
  id: true,
  extractedAt: true,
});

export type InsertDiscoverySource = z.infer<typeof insertDiscoverySourceSchema>;
export type DiscoverySource = typeof discoverySources.$inferSelect;
export type InsertDiscoverySearchRun = z.infer<typeof insertDiscoverySearchRunSchema>;
export type DiscoverySearchRun = typeof discoverySearchRuns.$inferSelect;
export type InsertDiscoveryResult = z.infer<typeof insertDiscoveryResultSchema>;
export type DiscoveryResult = typeof discoveryResults.$inferSelect;

// ============================================================================
// WETGEVING (Legislation) - BWB Regulations from KOOP/overheid.nl
// ============================================================================

// Database table: Track uploaded legislation to Pinecone
export const uploadedLaws = pgTable("uploaded_laws", {
  id: serial("id").primaryKey(),
  bwbId: varchar("bwb_id", { length: 50 }).notNull(), // e.g., BWBR0001840
  title: text("title").notNull(), // Official title (citeertitel)
  lawType: varchar("law_type", { length: 100 }), // wet, amvb, ministeriële regeling, etc.
  validFrom: varchar("valid_from", { length: 20 }), // ISO date string
  validTo: varchar("valid_to", { length: 20 }), // ISO date string or null for open-ended
  xmlHash: varchar("xml_hash", { length: 64 }).notNull(), // SHA-256 hash of XML content
  chunkCount: integer("chunk_count").notNull().default(0),
  namespace: varchar("namespace", { length: 100 }).notNull().default("laws-current"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Unique constraint on BWB ID + validity period
  uniqueBwbValidity: uniqueIndex("unique_bwb_validity").on(table.bwbId, table.validFrom, table.validTo),
  bwbIdIdx: index("bwb_id_idx").on(table.bwbId),
  namespaceIdx: index("law_namespace_idx").on(table.namespace),
}));

// Zod schemas for legislation
export const insertUploadedLawSchema = createInsertSchema(uploadedLaws).omit({
  id: true,
  uploadedAt: true,
  updatedAt: true,
});

export type InsertUploadedLaw = z.infer<typeof insertUploadedLawSchema>;
export type UploadedLaw = typeof uploadedLaws.$inferSelect;

// BWB Regulation record from SRU search
export const bwbRegulationSchema = z.object({
  bwbId: z.string(), // e.g., BWBR0001840
  title: z.string(), // Official title
  lawType: z.string().optional(), // wet, amvb, etc.
  publisher: z.string().optional(),
  dateModified: z.string().optional(),
  xmlUrl: z.string().optional(), // URL to XML content
  isSelected: z.boolean().optional().default(false), // UI selection state
});

export type BwbRegulation = z.infer<typeof bwbRegulationSchema>;

// Legislation chunk for Pinecone
export const lawChunkSchema = z.object({
  id: z.string(), // <BWB-ID>#<article>#<paragraph>#<valid-from>
  text: z.string(), // Plain text content
  bwbId: z.string(),
  title: z.string(),
  articleNumber: z.string().optional(),
  paragraphNumber: z.string().optional(),
  sectionTitle: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  isCurrent: z.boolean().default(true),
  chunkIndex: z.number().optional(),
  totalChunks: z.number().optional(),
});

export type LawChunk = z.infer<typeof lawChunkSchema>;

// Request to check duplicate laws
export const checkDuplicateLawsRequestSchema = z.object({
  bwbIds: z.array(z.string()),
  validFrom: z.string().optional(),
});

export type CheckDuplicateLawsRequest = z.infer<typeof checkDuplicateLawsRequestSchema>;

// Response for duplicate law check
export const lawUploadStatusSchema = z.object({
  bwbId: z.string(),
  isUploaded: z.boolean(),
  uploadedAt: z.string().optional(),
  chunkCount: z.number().optional(),
});

export type LawUploadStatus = z.infer<typeof lawUploadStatusSchema>;
