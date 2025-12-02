import { Pinecone } from '@pinecone-database/pinecone';

async function queryPinecone() {
  const apiKey = process.env.PINECONE_API_KEY;
  const indexHost = process.env.VITE_PINECONE_INDEX_HOST;
  
  if (!apiKey || !indexHost) {
    console.error('Missing PINECONE_API_KEY or VITE_PINECONE_INDEX_HOST');
    return;
  }
  
  console.log('Index Host:', indexHost);
  
  const pc = new Pinecone({ apiKey });
  const indexName = indexHost.split('.')[0];
  const index = pc.index(indexName, indexHost);
  
  // Test 1: Fetch by exact filter on title and article_number
  console.log('\n=== TEST 1: Filter op title + article_number 2.2 ===');
  try {
    const results = await index.namespace('laws-current').query({
      vector: new Array(1024).fill(0), // dummy vector for metadata-only query
      topK: 10,
      includeMetadata: true,
      filter: {
        title: { $eq: "Benelux-verdrag inzake de intellectuele eigendom" },
        article_number: { $eq: "2.2" }
      }
    });
    
    console.log('Resultaten voor 2.2:', results.matches?.length || 0);
    results.matches?.forEach((match, i) => {
      console.log(`\n--- Match ${i + 1} ---`);
      console.log('ID:', match.id);
      console.log('Score:', match.score);
      console.log('Article Number:', match.metadata?.article_number);
      console.log('Title:', match.metadata?.title);
      console.log('Text preview:', (match.metadata?.text as string)?.substring(0, 300));
    });
  } catch (error: any) {
    console.error('Error:', error.message);
  }
  
  // Test 2: Check what article_number values exist for this title
  console.log('\n\n=== TEST 2: Alle artikelen van dit verdrag ===');
  try {
    const results = await index.namespace('laws-current').query({
      vector: new Array(1024).fill(0),
      topK: 100,
      includeMetadata: true,
      filter: {
        title: { $eq: "Benelux-verdrag inzake de intellectuele eigendom" }
      }
    });
    
    console.log('Totaal resultaten:', results.matches?.length || 0);
    
    // Show all unique article numbers sorted
    const allArticleNumbers = [...new Set(results.matches?.map(m => m.metadata?.article_number))].sort((a, b) => {
      const numA = parseFloat(String(a || '0').replace(',', '.'));
      const numB = parseFloat(String(b || '0').replace(',', '.'));
      return numA - numB;
    });
    console.log('\nAlle gevonden article_numbers:', allArticleNumbers);
    
    // Check if 2.2 exists
    const has22 = allArticleNumbers.includes('2.2');
    console.log('\nBevat artikel 2.2?', has22);
    
    // Show articles 2.x
    console.log('\nArtikelen met 2.x:');
    results.matches?.filter(m => 
      String(m.metadata?.article_number || '').startsWith('2.')
    ).forEach(match => {
      console.log(`  - ${match.metadata?.article_number}: ID=${match.id}`);
    });
  } catch (error: any) {
    console.error('Error:', error.message);
  }
  
  // Test 3: Try different article_number formats
  console.log('\n\n=== TEST 3: Zoek met verschillende formaten ===');
  const formats = ['2.2', '2,2', '2.02', '2.2.', 'Artikel 2.2', 'artikel 2.2'];
  for (const format of formats) {
    try {
      const results = await index.namespace('laws-current').query({
        vector: new Array(1024).fill(0),
        topK: 5,
        includeMetadata: true,
        filter: {
          title: { $eq: "Benelux-verdrag inzake de intellectuele eigendom" },
          article_number: { $eq: format }
        }
      });
      console.log(`Format "${format}": ${results.matches?.length || 0} resultaten`);
    } catch (error: any) {
      console.log(`Format "${format}": Error - ${error.message}`);
    }
  }
}

queryPinecone().catch(console.error);
