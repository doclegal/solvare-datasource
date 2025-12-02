import { Pinecone } from '@pinecone-database/pinecone';

async function describePinecone() {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexHost = process.env.VITE_PINECONE_INDEX_HOST;
  
  if (!apiKey || !indexHost) {
    console.error('Missing env vars');
    return;
  }
  
  console.log('Connecting to Pinecone...');
  console.log('Index Host:', indexHost);
  
  const pc = new Pinecone({ apiKey });
  const indexName = indexHost.split('.')[0];
  
  try {
    // Describe the index
    const indexInfo = await pc.describeIndex(indexName);
    console.log('\nIndex Info:', JSON.stringify(indexInfo, null, 2));
    
    // Get index stats
    const index = pc.index(indexName, indexHost);
    const stats = await index.describeIndexStats();
    console.log('\nIndex Stats:', JSON.stringify(stats, null, 2));
  } catch (error: any) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

describePinecone().catch(console.error);
