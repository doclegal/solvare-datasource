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
      // Convert records to Pinecone format
      const vectors = batch.map(record => ({
        id: record.ecli,
        values: [], // Empty array - will use Pinecone's inference API
        metadata: {
          text: record.fullText,
          title: record.title,
          court: record.court,
          decision_date: record.decisionDate,
          legal_area: record.legalArea.join(', '),
          procedure_type: record.procedureType,
          source_url: record.sourceUrl,
        },
      }));
      
      // Upsert to Pinecone
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
