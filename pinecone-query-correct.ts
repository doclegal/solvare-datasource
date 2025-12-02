import { Pinecone } from '@pinecone-database/pinecone';

async function queryPinecone() {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  const pc = new Pinecone({ apiKey });
  
  // Use the CORRECT index from listIndexes
  const correctHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
  const index = pc.index('rechtstreeks', correctHost);
  
  console.log('Using correct index: rechtstreeks');
  console.log('Host:', correctHost);
  
  // First, get index stats
  console.log('\n=== Index Stats ===');
  try {
    const stats = await index.describeIndexStats();
    console.log(JSON.stringify(stats, null, 2));
  } catch (error: any) {
    console.error('Stats error:', error.message);
  }
  
  // Test 1: Find all records for Benelux verdrag
  console.log('\n\n=== TEST 1: Alle artikelen Benelux-verdrag ===');
  try {
    const results = await index.namespace('laws-current').query({
      vector: new Array(1024).fill(0.01), // slightly non-zero vector
      topK: 100,
      includeMetadata: true,
      filter: {
        title: { $eq: "Benelux-verdrag inzake de intellectuele eigendom" }
      }
    });
    
    console.log('Totaal resultaten:', results.matches?.length || 0);
    
    // Show all unique article numbers sorted
    const allArticleNumbers = [...new Set(results.matches?.map(m => m.metadata?.article_number))].filter(Boolean).sort((a, b) => {
      const numA = parseFloat(String(a || '0').replace(',', '.'));
      const numB = parseFloat(String(b || '0').replace(',', '.'));
      return numA - numB;
    });
    console.log('\nAlle gevonden article_numbers:', allArticleNumbers);
    
    // Check specifically for 2.2 and 2.20
    const has22 = allArticleNumbers.includes('2.2');
    const has220 = allArticleNumbers.includes('2.20');
    console.log('\nBevat artikel 2.2?', has22);
    console.log('Bevat artikel 2.20?', has220);
    
    // Show articles that start with "2."
    console.log('\nArtikelen met 2.x:');
    results.matches?.filter(m => 
      String(m.metadata?.article_number || '').startsWith('2.')
    ).forEach(match => {
      console.log(`  - article_number: "${match.metadata?.article_number}" | ID: ${match.id}`);
      console.log(`    Text preview: ${(match.metadata?.text as string)?.substring(0, 150)}...`);
    });
  } catch (error: any) {
    console.error('Error:', error.message);
  }
  
  // Test 2: Exact filter for 2.2
  console.log('\n\n=== TEST 2: Exacte filter article_number = "2.2" ===');
  try {
    const results = await index.namespace('laws-current').query({
      vector: new Array(1024).fill(0.01),
      topK: 10,
      includeMetadata: true,
      filter: {
        title: { $eq: "Benelux-verdrag inzake de intellectuele eigendom" },
        article_number: { $eq: "2.2" }
      }
    });
    
    console.log('Resultaten:', results.matches?.length || 0);
    results.matches?.forEach((m, i) => {
      console.log(`\n[${i+1}] ID: ${m.id}`);
      console.log(`    article_number: "${m.metadata?.article_number}"`);
      console.log(`    Text: ${(m.metadata?.text as string)?.substring(0, 200)}...`);
    });
  } catch (error: any) {
    console.error('Error:', error.message);
  }
  
  // Test 3: Check different namespaces
  console.log('\n\n=== TEST 3: Check all namespaces ===');
  try {
    const stats = await index.describeIndexStats();
    console.log('Namespaces:', Object.keys(stats.namespaces || {}));
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

queryPinecone().catch(console.error);
