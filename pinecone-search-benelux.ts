import { Pinecone } from '@pinecone-database/pinecone';

async function searchBenelux() {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  const pc = new Pinecone({ apiKey });
  const correctHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
  const index = pc.index('rechtstreeks', correctHost);
  
  const namespaces = ['laws-current', 'laws-local', 'ECLI_NL', 'WEB_ECLI'];
  
  for (const ns of namespaces) {
    console.log(`\n=== Searching namespace: ${ns} ===`);
    try {
      const results = await index.namespace(ns).query({
        vector: new Array(1024).fill(0.01),
        topK: 100,
        includeMetadata: true
      });
      
      console.log(`Total records sampled: ${results.matches?.length || 0}`);
      
      // Search for Benelux in titles and text
      const beneluxMatches = results.matches?.filter(m => {
        const title = String(m.metadata?.title || '').toLowerCase();
        const text = String(m.metadata?.text || '').toLowerCase();
        return title.includes('benelux') || text.includes('benelux');
      });
      
      if (beneluxMatches && beneluxMatches.length > 0) {
        console.log(`\nFound ${beneluxMatches.length} Benelux matches!`);
        beneluxMatches.forEach(m => {
          console.log(`  - Title: ${m.metadata?.title}`);
          console.log(`    article_number: ${m.metadata?.article_number}`);
          console.log(`    ID: ${m.id}`);
        });
      } else {
        console.log('No Benelux mentions found in sample');
      }
      
      // Also check for "intellectuele eigendom"
      const ipMatches = results.matches?.filter(m => {
        const title = String(m.metadata?.title || '').toLowerCase();
        const text = String(m.metadata?.text || '').toLowerCase();
        return title.includes('intellectuele') || text.includes('intellectuele eigendom');
      });
      
      if (ipMatches && ipMatches.length > 0) {
        console.log(`\nFound ${ipMatches.length} "intellectuele eigendom" matches!`);
        ipMatches.slice(0, 5).forEach(m => {
          console.log(`  - Title: ${m.metadata?.title}`);
          console.log(`    article_number: ${m.metadata?.article_number}`);
        });
      }
      
    } catch (error: any) {
      console.error(`Error in ${ns}:`, error.message);
    }
  }
  
  // Also try listing with BWBV prefix (verdragen hebben vaak BWBV)
  console.log('\n\n=== Looking for BWBV (verdragen) IDs ===');
  try {
    const listResult = await index.namespace('laws-current').listPaginated({
      prefix: 'BWBV',
      limit: 20
    });
    console.log('BWBV IDs found:', listResult.vectors?.map(v => v.id) || 'none');
  } catch (error: any) {
    console.error('List error:', error.message);
  }
}

searchBenelux().catch(console.error);
