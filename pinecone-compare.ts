import { Pinecone } from '@pinecone-database/pinecone';

async function compareArticles() {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  const pc = new Pinecone({ apiKey });
  const correctHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
  const index = pc.index('rechtstreeks', correctHost);
  
  // Fetch both articles
  console.log('=== VERGELIJKING ARTIKEL 2.2 vs 2.20 ===\n');
  
  const fetchResult = await index.namespace('laws-current').fetch([
    'BWBV0001716#art2.2#2021-09-02',
    'BWBV0001716#art2.20#lid1#2021-09-02'
  ]);
  
  Object.entries(fetchResult.records || {}).forEach(([id, record]) => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`ID: ${id}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`title: ${record.metadata?.title}`);
    console.log(`article_number: "${record.metadata?.article_number}"`);
    console.log(`\nTekst:\n${record.metadata?.text}`);
    console.log('\n');
  });
  
  // Now test filter query - this is what the app likely does
  console.log('\n=== TEST: Query met filter article_number = "2.2" ===');
  const queryResult = await index.namespace('laws-current').query({
    vector: new Array(1024).fill(0.01),
    topK: 5,
    includeMetadata: true,
    filter: {
      bwb_id: { $eq: 'BWBV0001716' },
      article_number: { $eq: '2.2' }
    }
  });
  
  console.log(`\nResultaten: ${queryResult.matches?.length}`);
  queryResult.matches?.forEach(m => {
    console.log(`  - ID: ${m.id}`);
    console.log(`    article_number: "${m.metadata?.article_number}"`);
  });
  
  // Test with title filter like the app might do
  console.log('\n\n=== TEST: Query met filter op title + article_number ===');
  const queryResult2 = await index.namespace('laws-current').query({
    vector: new Array(1024).fill(0.01),
    topK: 5,
    includeMetadata: true,
    filter: {
      title: { $eq: 'Benelux-verdrag inzake de intellectuele eigendom (merken en tekeningen of modellen)' },
      article_number: { $eq: '2.2' }
    }
  });
  
  console.log(`Resultaten: ${queryResult2.matches?.length}`);
  queryResult2.matches?.forEach(m => {
    console.log(`  - ID: ${m.id}`);
    console.log(`    article_number: "${m.metadata?.article_number}"`);
    console.log(`    title: "${m.metadata?.title}"`);
  });
  
  // The USER's query may be using a DIFFERENT title!
  console.log('\n\n=== DIAGNOSE: Waarschijnlijke oorzaak ===');
  console.log('De EXACTE title in Pinecone is:');
  console.log('"Benelux-verdrag inzake de intellectuele eigendom (merken en tekeningen of modellen)"');
  console.log('\nDe gebruiker zoekt mogelijk met:');
  console.log('"Benelux-verdrag inzake de intellectuele eigendom"');
  console.log('\nDeze zijn NIET gelijk! De filter matcht niet.');
}

compareArticles().catch(console.error);
