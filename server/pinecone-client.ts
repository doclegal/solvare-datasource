import { Pinecone } from '@pinecone-database/pinecone';
import type { PreparedRecord, ChunkedRecord } from '@shared/schema';

let pineconeClient: Pinecone | null = null;

interface SparseVector {
  indices: number[];
  values: number[];
}

/**
 * Generate sparse vectors using term frequency for keyword-based retrieval
 * This is a deterministic, simple approach that works well for Dutch legal text
 * 
 * IMPORTANT FOR QUERY-TIME USE:
 * To perform hybrid search queries, you MUST use the exact same tokenization
 * and hashing logic for your query text. The DJB2 hash function and tokenization
 * rules (lowercase, NFD normalization, extended Latin split, min length 3) must
 * be replicated exactly in your query pipeline.
 * 
 * Example query-time usage:
 * ```typescript
 * const queryText = "huurrecht bedrijfsruimte";
 * const querySparseVector = generateSparseVector(queryText);
 * 
 * const results = await index.query({
 *   vector: queryDenseEmbedding,      // from Pinecone inference API
 *   sparseVector: querySparseVector,  // using THIS function
 *   topK: 10
 * });
 * ```
 */
function generateSparseVector(text: string): SparseVector {
  if (!text || text.trim().length === 0) {
    return { indices: [], values: [] };
  }
  
  // Tokenize: preserve Dutch characters, lowercase, split on whitespace/punctuation
  const tokens = text
    .toLowerCase()
    .normalize('NFD') // Normalize diacritics for consistent handling
    .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritics after normalization
    .split(/[^a-z0-9\u00C0-\u024F]+/i) // Split on non-alphanumeric (including extended Latin)
    .filter(t => t.length >= 3); // Filter out very short tokens
  
  if (tokens.length === 0) {
    return { indices: [], values: [] };
  }
  
  // Count term frequencies
  const termFreq = new Map<string, number>();
  tokens.forEach(token => {
    termFreq.set(token, (termFreq.get(token) || 0) + 1);
  });
  
  // Build sparse vector using consistent hashing
  const entries: Array<{ index: number; value: number }> = [];
  const frequencies = Array.from(termFreq.values());
  const maxFreq = Math.max(...frequencies);
  
  termFreq.forEach((freq, term) => {
    // Deterministic hash using DJB2 algorithm
    const index = djb2Hash(term);
    // Normalized term frequency (0-1 range)
    const normalizedTF = freq / maxFreq;
    
    entries.push({ index, value: normalizedTF });
  });
  
  // Sort by value (descending) to keep most informative terms
  entries.sort((a, b) => b.value - a.value);
  
  // Limit to top 1000 highest-weighted terms (Pinecone's limit)
  const topEntries = entries.slice(0, 1000);
  
  // Re-sort by index for consistent Pinecone format
  topEntries.sort((a, b) => a.index - b.index);
  
  return {
    indices: topEntries.map(e => e.index),
    values: topEntries.map(e => e.value),
  };
}

/**
 * DJB2 hash function - deterministic and widely used
 * Returns a positive integer suitable for Pinecone sparse indices
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  // Ensure positive number within reasonable range
  return Math.abs(hash) >>> 0; // Convert to unsigned 32-bit integer
}

function initializePinecone(): Pinecone {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    throw new Error('PINECONE_API_KEY niet gevonden in environment variables');
  }
  
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey,
    });
  }
  
  return pineconeClient;
}

interface UploadProgress {
  totalRecords: number;
  processedRecords: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ ecli: string; error: string }>;
}

type ExportableRecord = PreparedRecord | ChunkedRecord;

function isChunkedRecord(record: ExportableRecord): record is ChunkedRecord {
  return 'chunk_id' in record && 'section_type' in record;
}

/**
 * Upload a single record to Pinecone immediately (for real-time enrichment)
 * Returns true on success, false on failure
 */
export async function upsertSingleRecordToPinecone(
  indexHost: string,
  record: ExportableRecord,
  namespace: string = ''
): Promise<{ success: boolean; error?: string }> {
  try {
    const pc = initializePinecone();
    const indexName = indexHost.split('.')[0];
    const index = pc.index(indexName, indexHost);
    
    // Generate text for embedding
    let textForEmbedding: string;
    if (isChunkedRecord(record)) {
      textForEmbedding = record.text;
    } else {
      const textParts: string[] = [record.inhoudsindicatie];
      if (record.ai_inhoudsindicatie) textParts.push(record.ai_inhoudsindicatie);
      if (record.ai_feiten) textParts.push(record.ai_feiten);
      if (record.ai_geschil) textParts.push(record.ai_geschil);
      if (record.ai_beslissing) textParts.push(record.ai_beslissing);
      if (record.ai_motivering) textParts.push(record.ai_motivering);
      textForEmbedding = textParts.join('\n\n');
    }
    
    // Generate embeddings (single record = batch of 1)
    const embeddingsResponse = await pc.inference.embed(
      'multilingual-e5-large',
      [textForEmbedding],
      { inputType: 'passage' }
    );
    
    const embedding = embeddingsResponse.data[0];
    if (!embedding || embedding.vectorType !== 'dense' || !('values' in embedding)) {
      throw new Error(`Failed to generate dense embedding for ECLI: ${record.ecli}`);
    }
    
    // Generate sparse vector
    const sparseVector = generateSparseVector(textForEmbedding);
    
    // Prepare metadata (same logic as batch upload)
    let metadata: Record<string, string | number | boolean>;
    let vectorId: string;
    
    if (isChunkedRecord(record)) {
      vectorId = record.chunk_id;
      metadata = {
        text: record.text,
        ecli: record.ecli,
        chunk_id: record.chunk_id,
        section_type: record.section_type,
        title: record.title,
        court_name: record.court_name,
        decision_date: record.decision_date,
        source_url: record.source_url,
        is_civil: record.is_civil,
      };
      // Add optional fields
      if (record.decision_year !== undefined) metadata.decision_year = record.decision_year;
      if (record.is_kanton_case !== undefined) metadata.is_kanton_case = record.is_kanton_case;
      if (record.civil_domain) metadata.civil_domain = record.civil_domain;
      if (record.case_subtype) metadata.case_subtype = record.case_subtype;
      if (record.procedure_type) metadata.procedure_type = record.procedure_type;
      if (record.court_level) metadata.court_level = record.court_level;
      if (record.outcome) metadata.outcome = record.outcome;
      if (record.party_1_type) metadata.party_1_type = record.party_1_type;
      if (record.party_2_type) metadata.party_2_type = record.party_2_type;
      if (record.claim_types && record.claim_types.length > 0) {
        metadata.claim_types = record.claim_types.join(', ');
      }
      if (record.burden_of_proof_on) metadata.burden_of_proof_on = record.burden_of_proof_on;
      if (record.legal_issue) metadata.legal_issue = record.legal_issue;
      if (record.key_facts_tags && record.key_facts_tags.length > 0) {
        metadata.key_facts_tags = record.key_facts_tags.join(', ');
      }
    } else {
      vectorId = record.ecli;
      metadata = {
        ecli: record.ecli,
        title: record.title,
        court: record.court,
        decision_date: record.decisionDate,
        source_url: record.sourceUrl,
        inhoudsindicatie: record.inhoudsindicatie,
        procedure_type: record.procedureType,
      };
      // Add legalArea as comma-separated string
      if (record.legalArea && record.legalArea.length > 0) {
        metadata.legal_area = record.legalArea.join(', ');
      }
      // Add AI fields if present
      if (record.ai_inhoudsindicatie) metadata.ai_inhoudsindicatie = record.ai_inhoudsindicatie;
      if (record.ai_feiten) metadata.ai_feiten = record.ai_feiten;
      if (record.ai_geschil) metadata.ai_geschil = record.ai_geschil;
      if (record.ai_beslissing) metadata.ai_beslissing = record.ai_beslissing;
      if (record.ai_motivering) metadata.ai_motivering = record.ai_motivering;
      // Add optional source URLs
      if (record.alsoReadOn && record.alsoReadOn.length > 0) {
        metadata.also_read_on = record.alsoReadOn.join(', ');
      }
    }
    
    // Upsert single vector
    await index.namespace(namespace).upsert([{
      id: vectorId,
      values: embedding.values,
      sparseValues: sparseVector,
      metadata,
    }]);
    
    return { success: true };
  } catch (error: any) {
    console.error(`[Pinecone] Failed to upload ${record.ecli}:`, error.message);
    return { success: false, error: error.message };
  }
}

export async function upsertRecordsToPinecone(
  indexHost: string,
  records: ExportableRecord[],
  namespace: string = '',
  batchSize: number = 96,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadProgress> {
  const pc = initializePinecone();
  
  // Extract index name from host
  // Format: index-name-abc123.svc.region.pinecone.io
  const indexName = indexHost.split('.')[0];
  
  // This implementation uses Pinecone's Inference API to generate dense embeddings
  // using the 'multilingual-e5-large' model, which supports Dutch text well.
  // Additionally, it generates sparse vectors (BM25-like) for hybrid search support.
  // Both vector types are uploaded to your Pinecone index for optimal retrieval.
  // Use the full host URL to bypass index lookup
  const index = pc.index(indexName, indexHost);
  const targetNamespace = namespace || '';
  
  // Enforce Pinecone Inference API limit for multilingual-e5-large model
  const safeBatchSize = Math.min(batchSize, 96);
  
  const progress: UploadProgress = {
    totalRecords: records.length,
    processedRecords: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
  };
  
  // Process records in batches (max 96 per batch due to Pinecone Inference API limit)
  for (let i = 0; i < records.length; i += safeBatchSize) {
    const batch = records.slice(i, i + safeBatchSize);
    
    try {
      // Step 1: Generate embeddings using Pinecone's Inference API
      // For PreparedRecords: combine all AI summary fields for comprehensive embedding
      const inputs = batch.map(record => {
        if (isChunkedRecord(record)) {
          return record.text;
        } else {
          // Combine all text for better semantic search
          const textParts: string[] = [record.inhoudsindicatie];
          if (record.ai_inhoudsindicatie) textParts.push(record.ai_inhoudsindicatie);
          if (record.ai_feiten) textParts.push(record.ai_feiten);
          if (record.ai_geschil) textParts.push(record.ai_geschil);
          if (record.ai_beslissing) textParts.push(record.ai_beslissing);
          if (record.ai_motivering) textParts.push(record.ai_motivering);
          return textParts.join('\n\n');
        }
      });
      const embeddingsResponse = await pc.inference.embed(
        'multilingual-e5-large',
        inputs,
        { inputType: 'passage' }
      );
      
      // Step 2: Generate sparse vectors (BM25-like) for hybrid search
      const sparseVectors = inputs.map(text => generateSparseVector(text));
      
      // Step 3: Prepare vectors with embeddings and metadata
      const vectors = batch.map((record, idx) => {
        const embedding = embeddingsResponse.data[idx];
        const sparseVector = sparseVectors[idx];
        
        // Type guard: ensure we have a dense embedding with values
        if (!embedding || embedding.vectorType !== 'dense' || !('values' in embedding)) {
          throw new Error(`Failed to generate dense embedding for ECLI: ${record.ecli}`);
        }
        
        if (isChunkedRecord(record)) {
          // For chunks: use chunk_id and include rich metadata
          // Filter out undefined values as Pinecone doesn't accept them
          const metadata: Record<string, string | number | boolean> = {
            text: record.text,
            ecli: record.ecli,
            chunk_id: record.chunk_id,
            section_type: record.section_type,
            title: record.title,
            court_name: record.court_name,
            decision_date: record.decision_date,
            source_url: record.source_url,
            is_civil: record.is_civil,
          };
          
          // Add optional fields only if defined
          if (record.decision_year !== undefined) metadata.decision_year = record.decision_year;
          if (record.is_kanton_case !== undefined) metadata.is_kanton_case = record.is_kanton_case;
          if (record.civil_domain) metadata.civil_domain = record.civil_domain;
          if (record.case_subtype) metadata.case_subtype = record.case_subtype;
          if (record.procedure_type) metadata.procedure_type = record.procedure_type;
          if (record.court_level) metadata.court_level = record.court_level;
          if (record.outcome) metadata.outcome = record.outcome;
          if (record.party_1_type) metadata.party_1_type = record.party_1_type;
          if (record.party_2_type) metadata.party_2_type = record.party_2_type;
          if (record.claim_types && record.claim_types.length > 0) {
            metadata.claim_types = record.claim_types.join(', ');
          }
          if (record.burden_of_proof_on) metadata.burden_of_proof_on = record.burden_of_proof_on;
          if (record.legal_issue) metadata.legal_issue = record.legal_issue;
          if (record.key_facts_tags && record.key_facts_tags.length > 0) {
            metadata.key_facts_tags = record.key_facts_tags.join(', ');
          }
          if (record.evidence_themes && record.evidence_themes.length > 0) {
            metadata.evidence_themes = record.evidence_themes.join(', ');
          }
          if (record.risk_profile && record.risk_profile.length > 0) {
            metadata.risk_profile = record.risk_profile.join(', ');
          }
          if (record.statutes_and_articles && record.statutes_and_articles.length > 0) {
            metadata.statutes_and_articles = record.statutes_and_articles.join(', ');
          }
          
          return {
            id: record.chunk_id,
            values: embedding.values,
            sparseValues: sparseVector,
            metadata,
          };
        } else {
          // For metadata-only records: use ecli and metadata
          // Combine all AI summary fields for better searchability
          const textParts: string[] = [];
          
          // Start with official summary as base
          textParts.push(record.inhoudsindicatie);
          
          // Add AI summary sections if available (for comprehensive search coverage)
          if (record.ai_inhoudsindicatie) textParts.push(record.ai_inhoudsindicatie);
          if (record.ai_feiten) textParts.push(record.ai_feiten);
          if (record.ai_geschil) textParts.push(record.ai_geschil);
          if (record.ai_beslissing) textParts.push(record.ai_beslissing);
          if (record.ai_motivering) textParts.push(record.ai_motivering);
          
          // Combine with double newline for readability
          const combinedText = textParts.join('\n\n');
          
          const metadata: Record<string, string | number | boolean> = {
            text: combinedText,
            ecli: record.ecli,
            title: record.title,
            court: record.court,
            decision_date: record.decisionDate,
            legal_area: record.legalArea.join(', '),
            procedure_type: record.procedureType,
            source_url: record.sourceUrl,
          };
          
          // Note: AI summary sections are already included in the embeddings via combinedText
          // and in the 'text' field above. We don't store them as separate metadata fields
          // to avoid exceeding Pinecone's 40KB metadata limit per vector.
          
          // Add alsoReadOn if available (from discovery)
          if (record.alsoReadOn && record.alsoReadOn.length > 0) {
            metadata.also_read_on = record.alsoReadOn.join(', ');
          }
          
          // Add flag to indicate AI enrichment status
          if (record.ai_inhoudsindicatie || record.ai_feiten || record.ai_geschil || 
              record.ai_beslissing || record.ai_motivering) {
            metadata.has_ai_summary = true;
          }
          
          return {
            id: record.ecli,
            values: embedding.values,
            sparseValues: sparseVector,
            metadata,
          };
        }
      });
      
      // Step 4: Upsert hybrid vectors (dense + sparse) to Pinecone
      await index.namespace(targetNamespace).upsert(vectors);
      
      progress.processedRecords += batch.length;
      progress.successCount += batch.length;
      
      if (onProgress) {
        onProgress({ ...progress });
      }
    } catch (error: any) {
      console.error(`Error upserting batch starting at index ${i}:`, error);
      
      // Record errors for this batch
      batch.forEach(record => {
        progress.errors.push({
          ecli: record.ecli,
          error: error.message || 'Onbekende fout',
        });
      });
      
      progress.processedRecords += batch.length;
      progress.errorCount += batch.length;
      
      if (onProgress) {
        onProgress({ ...progress });
      }
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < records.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return progress;
}
