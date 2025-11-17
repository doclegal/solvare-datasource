#!/usr/bin/env node

// Upload ALLE 164 records naar Pinecone (met en zonder AI verrijking)

const batchId = '4bc1d2e3-87cf-4ca0-a34c-e21a4c9bc69d';
const baseUrl = 'http://localhost:5000';

async function main() {
  console.log('📥 Ophalen ALLE records uit PostgreSQL...');
  
  // Step 1: Get the batch with ALL records
  const batchResponse = await fetch(`${baseUrl}/api/rechtspraak/batch/${batchId}`);
  
  if (!batchResponse.ok) {
    throw new Error(`Failed to fetch batch: ${batchResponse.statusText}`);
  }
  
  const batchData = await batchResponse.json();
  const allRecords = batchData.batch.records;
  
  console.log(`✅ ${allRecords.length} TOTALE records opgehaald`);
  
  // Count enriched vs non-enriched
  const enrichedRecords = allRecords.filter(r => 
    r.ai_inhoudsindicatie || r.ai_feiten || r.ai_geschil || r.ai_beslissing || r.ai_motivering
  );
  const basicRecords = allRecords.length - enrichedRecords.length;
  
  console.log(`   ✨ ${enrichedRecords.length} met AI-verrijking`);
  console.log(`   📄 ${basicRecords} met basis metadata`);
  console.log(`📤 Uploaden ALLE ${allRecords.length} records naar Pinecone...`);
  
  // Step 2: Upload ALL records to Pinecone
  const exportConfig = {
    indexHost: 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io',
    namespace: 'ECLI_NL',
    batchSize: 96,
    records: allRecords  // Upload ALL 164
  };
  
  const exportResponse = await fetch(`${baseUrl}/api/pinecone/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(exportConfig)
  });
  
  if (!exportResponse.ok) {
    const error = await exportResponse.text();
    throw new Error(`Export failed: ${error}`);
  }
  
  // Read SSE stream
  const reader = exportResponse.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        
        if (data.type === 'progress') {
          console.log(`  [Batch ${data.currentBatch}/${data.totalBatches}] ${data.processedRecords}/${data.totalRecords} records verwerkt`);
        } else if (data.type === 'complete') {
          console.log('\n✅ UPLOAD VOLTOOID!');
          console.log(`   Succesvol: ${data.successCount}/${allRecords.length}`);
          console.log(`   Fouten: ${data.errorCount}`);
          if (data.errors && data.errors.length > 0) {
            console.log('\n❌ Errors:', data.errors);
          }
        } else if (data.type === 'error') {
          console.error('❌ ERROR:', data.error);
        } else if (data.message) {
          console.log(`  ${data.message}`);
        }
      }
    }
  }
}

main().catch(err => {
  console.error('❌ Script failed:', err.message);
  process.exit(1);
});
