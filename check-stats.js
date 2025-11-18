import { Pinecone } from '@pinecone-database/pinecone';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;

async function checkStats() {
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index('rechtstreeks-dmacda9', 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io');
  
  console.log('[Stats] Fetching index statistics...');
  const stats = await index.describeIndexStats();
  
  console.log('\n=== PINECONE INDEX STATISTICS ===');
  console.log('Total Records:', stats.totalRecordCount);
  console.log('Dimension:', stats.dimension);
  console.log('\nNamespaces:');
  Object.entries(stats.namespaces || {}).forEach(([name, data]) => {
    console.log(`  - ${name || '(default)'}: ${data.recordCount} records`);
  });
}

checkStats();
