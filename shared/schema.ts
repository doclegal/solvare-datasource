import { z } from "zod";

// Rechtspraak ECLI record schema
export const ecliRecordSchema = z.object({
  ecli: z.string(),
  title: z.string(),
  court: z.string(),
  decisionDate: z.string(),
});

export type EcliRecord = z.infer<typeof ecliRecordSchema>;

// Prepared record schema for Pinecone
export const preparedRecordSchema = z.object({
  ecli: z.string(),
  title: z.string(),
  court: z.string(),
  decisionDate: z.string(),
  legalArea: z.array(z.string()),
  procedureType: z.string(),
  sourceUrl: z.string(),
  fullText: z.string(),
});

export type PreparedRecord = z.infer<typeof preparedRecordSchema>;

// Search filters schema
export const searchFiltersSchema = z.object({
  batchSize: z.number().default(50),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  documentType: z.string().optional(),
  court: z.string().optional(),
  legalArea: z.string().optional(),
  fullDocumentsOnly: z.boolean().default(false),
  from: z.number().default(0),
});

export type SearchFilters = z.infer<typeof searchFiltersSchema>;

// Pinecone export config schema
export const exportConfigSchema = z.object({
  indexHost: z.string(),
  namespace: z.string().optional(),
  batchSize: z.number().default(100),
  records: z.array(preparedRecordSchema),
});

export type ExportConfig = z.infer<typeof exportConfigSchema>;
