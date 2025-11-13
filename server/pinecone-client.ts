import { Pinecone } from '@pinecone-database/pinecone';
import type { PreparedRecord } from '@shared/schema';

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

export async function upsertRecordsToPinecone(
  indexHost: string,
  records: PreparedRecord[],
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
  const index = pc.index(indexName);
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
      const embeddingsResponse = await pc.inference.embed({
        model: 'multilingual-e5-large',
        inputs: batch.map(record => record.fullText),
        parameters: { inputType: 'passage' }
      });
      
      // Step 2: Prepare vectors with embeddings and metadata
      const vectors = batch.map((record, idx) => {
        const embedding = embeddingsResponse.data[idx];
        
        // Type guard: ensure we have a dense embedding with values
        if (!embedding || embedding.vectorType !== 'dense' || !('values' in embedding)) {
          throw new Error(`Failed to generate dense embedding for ECLI: ${record.ecli}`);
        }
        
        return {
          id: record.ecli,
          values: embedding.values,
          metadata: {
            text: record.fullText,
            title: record.title,
            court: record.court,
            decision_date: record.decisionDate,
            legal_area: record.legalArea.join(', '),
            procedure_type: record.procedureType,
            source_url: record.sourceUrl,
          },
        };
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
