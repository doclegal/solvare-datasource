import { Pinecone } from '@pinecone-database/pinecone';
import type { PreparedRecord, ChunkedRecord } from '@shared/schema';

let pineconeClient: Pinecone | null = null;

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

export async function upsertRecordsToPinecone(
  indexHost: string,
  records: ExportableRecord[],
  namespace: string = '',
  batchSize: number = 100,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadProgress> {
  const pc = initializePinecone();
  
  // Extract index name from host
  // Format: index-name-abc123.svc.region.pinecone.io
  const indexName = indexHost.split('.')[0];
  
  // This implementation uses Pinecone's Inference API to generate embeddings
  // using the 'multilingual-e5-large' model, which supports Dutch text well.
  // The embeddings are then uploaded to your Pinecone index.
  // Use the full host URL to bypass index lookup
  const index = pc.index(indexName, indexHost);
  const targetNamespace = namespace || '';
  
  const progress: UploadProgress = {
    totalRecords: records.length,
    processedRecords: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
  };
  
  // Process records in batches
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    
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
      
      // Step 2: Prepare vectors with embeddings and metadata
      const vectors = batch.map((record, idx) => {
        const embedding = embeddingsResponse.data[idx];
        
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
          
          // Add AI summary sections as separate metadata fields for filtering
          if (record.ai_inhoudsindicatie) metadata.ai_inhoudsindicatie = record.ai_inhoudsindicatie;
          if (record.ai_feiten) metadata.ai_feiten = record.ai_feiten;
          if (record.ai_geschil) metadata.ai_geschil = record.ai_geschil;
          if (record.ai_beslissing) metadata.ai_beslissing = record.ai_beslissing;
          if (record.ai_motivering) metadata.ai_motivering = record.ai_motivering;
          
          // Add alsoReadOn if available (from discovery)
          if (record.alsoReadOn && record.alsoReadOn.length > 0) {
            metadata.also_read_on = record.alsoReadOn.join(', ');
          }
          
          return {
            id: record.ecli,
            values: embedding.values,
            metadata,
          };
        }
      });
      
      // Step 3: Upsert vectors with embeddings to Pinecone
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
