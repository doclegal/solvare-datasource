import { Pinecone } from '@pinecone-database/pinecone';

async function listPinecone() {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexHost = process.env.VITE_PINECONE_INDEX_HOST;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  console.log('Index Host from env:', indexHost);
  
  const pc = new Pinecone({ apiKey });
  
  try {
    // List all indexes
    const indexes = await pc.listIndexes();
    console.log('\nAvailable indexes:', JSON.stringify(indexes, null, 2));
    
    // Try to use the host directly without extracting index name
    if (indexHost) {
      console.log('\nTrying direct index access with full host...');
      const index = pc.index('rechtspraak', indexHost);
      
      const stats = await index.describeIndexStats();
      console.log('\nIndex Stats:', JSON.stringify(stats, null, 2));
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

listPinecone().catch(console.error);
