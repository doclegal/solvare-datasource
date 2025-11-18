import { Pinecone } from '@pinecone-database/pinecone';

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;

async function test() {
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index('rechtstreeks-dmacda9', 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io');
  
  console.log('[Test] Fetching TEST_ECLI_12345 from namespace ECLI_NL...');
  try {
    const result = await index.namespace('ECLI_NL').fetch(['TEST_ECLI_12345']);
    console.log('[Test] ✓ Fetch result:', JSON.stringify(result, null, 2));
    
    if (result.records && result.records['TEST_ECLI_12345']) {
      console.log('[Test] ✓ RECORD WAS FOUND! Upsert worked despite returning undefined!');
    } else {
      console.log('[Test] ✗ RECORD NOT FOUND. Upsert silently failed.');
    }
  } catch (err) {
    console.error('[Test] ✗ ERROR:', err.message);
  }
}

test();
