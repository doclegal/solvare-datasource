import { Pinecone } from '@pinecone-database/pinecone';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;

async function test() {
  console.log('[Test] API Key present:', !!PINECONE_API_KEY);
  
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index('rechtstreeks-dmacda9', 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io');
  
  console.log('[Test] Creating test vector...');
  const testVector = {
    id: 'TEST_ECLI_12345',
    values: Array(1024).fill(0.1),
    metadata: { test: 'simple_test' }
  };
  
  console.log('[Test] Attempting upsert to namespace ECLI_NL...');
  try {
    const response = await index.namespace('ECLI_NL').upsert([testVector]);
    
    console.log('[Test] ✓ Response:', JSON.stringify(response));
    console.log('[Test] ✓ upsertedCount:', response?.upsertedCount);
  } catch (err) {
    console.error('[Test] ✗ ERROR:', err.message);
  }
}

test();
