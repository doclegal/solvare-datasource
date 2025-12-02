import { Pinecone } from '@pinecone-database/pinecone';

async function checkBWBV() {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  const pc = new Pinecone({ apiKey });
  const correctHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
  const index = pc.index('rechtstreeks', correctHost);
  
  // List all BWBV0001716 articles
  console.log('=== All articles for BWBV0001716 ===');
  try {
    const listResult = await index.namespace('laws-current').listPaginated({
      prefix: 'BWBV0001716',
      limit: 100
    });
    
    const allIds = listResult.vectors?.map(v => v.id) || [];
    console.log(`Found ${allIds.length} vector IDs`);
    
    // Look for art2.2
    const art22Ids = allIds.filter(id => id.includes('art2.2'));
    console.log('\nIDs containing "art2.2":', art22Ids);
    
    // Look for art2.20
    const art220Ids = allIds.filter(id => id.includes('art2.20'));
    console.log('IDs containing "art2.20":', art220Ids);
    
    // Show all article 2.x IDs
    const art2Ids = allIds.filter(id => id.includes('#art2.'));
    console.log('\nAll article 2.x IDs:', art2Ids);
    
  } catch (error: any) {
    console.error('List error:', error.message);
  }
  
  // Fetch specific records to see their metadata
  console.log('\n\n=== Fetching specific records ===');
  try {
    // Try to fetch art2.2 directly
    const fetchResult = await index.namespace('laws-current').fetch([
      'BWBV0001716#art2.2#2021-09-02',
      'BWBV0001716#art2.20#2021-09-02'
    ]);
    
    console.log('Fetched records:');
    Object.entries(fetchResult.records || {}).forEach(([id, record]) => {
      console.log(`\n[${id}]`);
      console.log('  title:', record.metadata?.title);
      console.log('  article_number:', record.metadata?.article_number);
      console.log('  text preview:', String(record.metadata?.text || '').substring(0, 300));
    });
    
    // If no art2.2, let's see what we have
    if (Object.keys(fetchResult.records || {}).length === 0) {
      console.log('\nNo records found with those exact IDs. Let me check what article 2 records exist...');
      
      // Query with filter
      const queryResult = await index.namespace('laws-current').query({
        vector: new Array(1024).fill(0.01),
        topK: 50,
        includeMetadata: true,
        filter: {
          bwb_id: { $eq: 'BWBV0001716' }
        }
      });
      
      console.log(`\nQuery returned ${queryResult.matches?.length} records for BWBV0001716`);
      
      // Show article numbers
      const articleNums = queryResult.matches?.map(m => m.metadata?.article_number).filter(Boolean);
      const uniqueArticles = [...new Set(articleNums)].sort();
      console.log('\nUnique article_numbers:', uniqueArticles);
      
      // Check title
      const titles = [...new Set(queryResult.matches?.map(m => m.metadata?.title))];
      console.log('\nUnique titles:', titles);
      
      // Find 2.2 and 2.20
      queryResult.matches?.filter(m => {
        const artNum = String(m.metadata?.article_number || '');
        return artNum === '2.2' || artNum === '2.20' || artNum.startsWith('2.');
      }).forEach(m => {
        console.log(`\n  article_number: "${m.metadata?.article_number}"`);
        console.log(`  ID: ${m.id}`);
        console.log(`  text: ${String(m.metadata?.text || '').substring(0, 200)}...`);
      });
    }
  } catch (error: any) {
    console.error('Fetch error:', error.message);
  }
}

checkBWBV().catch(console.error);
