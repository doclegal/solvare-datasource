import { Pinecone } from '@pinecone-database/pinecone';

async function findAll22() {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  const pc = new Pinecone({ apiKey });
  const correctHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
  const index = pc.index('rechtstreeks', correctHost);
  
  // Fetch ALL records with article_number 2.2 for this verdrag
  console.log('=== ALLE records met article_number "2.2" voor BWBV0001716 ===\n');
  
  const queryResult = await index.namespace('laws-current').query({
    vector: new Array(1024).fill(0.01),
    topK: 100,
    includeMetadata: true,
    filter: {
      bwb_id: { $eq: 'BWBV0001716' },
      article_number: { $eq: '2.2' }
    }
  });
  
  console.log(`Gevonden: ${queryResult.matches?.length} records\n`);
  
  queryResult.matches?.forEach((m, i) => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[${i+1}] ID: ${m.id}`);
    console.log(`    article_number: "${m.metadata?.article_number}"`);
    console.log(`    section_title: "${m.metadata?.section_title || 'N/A'}"`);
    console.log(`    structure_path: "${m.metadata?.structure_path || 'N/A'}"`);
    console.log(`    titel_naam: "${m.metadata?.titel_naam || 'N/A'}"`);
    console.log(`\n    Tekst (eerste 400 chars):`);
    console.log(`    ${String(m.metadata?.text || '').substring(0, 400).replace(/\n/g, '\n    ')}`);
    console.log('');
  });
  
  // Now let's see what metadata fields could distinguish between Verdrag and Uitvoeringsreglement
  console.log('\n\n=== METADATA ANALYSE ===');
  console.log('Beschikbare metadata velden per record:');
  
  const firstMatch = queryResult.matches?.[0];
  if (firstMatch) {
    console.log('Keys:', Object.keys(firstMatch.metadata || {}));
  }
  
  // List all unique structure_path values
  const structurePaths = [...new Set(queryResult.matches?.map(m => m.metadata?.structure_path))];
  console.log('\nUnique structure_path waarden:', structurePaths);
  
  // List all unique titel_naam values
  const titelNamen = [...new Set(queryResult.matches?.map(m => m.metadata?.titel_naam))];
  console.log('\nUnique titel_naam waarden:', titelNamen);
  
  // Check if there's a field that distinguishes Verdrag from Uitvoeringsreglement
  console.log('\n\n=== ZOEKEN NAAR "Verkrijging van het recht" (het echte verdragsartikel) ===');
  
  const verkrijging = queryResult.matches?.filter(m => 
    String(m.metadata?.text || '').toLowerCase().includes('verkrijging van het recht')
  );
  
  if (verkrijging && verkrijging.length > 0) {
    console.log(`\nGevonden ${verkrijging.length} matches met "Verkrijging van het recht":`);
    verkrijging.forEach(m => {
      console.log(`  - ID: ${m.id}`);
      console.log(`    Tekst: ${String(m.metadata?.text || '').substring(0, 300)}...`);
    });
  } else {
    console.log('\nGeen matches gevonden met "Verkrijging van het recht"');
    console.log('Dit artikel staat mogelijk NIET in de database!');
  }
  
  // Let's also search for "Meervoudig depot" to confirm that's what we found
  console.log('\n\n=== Controleer "Meervoudig depot" (Uitvoeringsreglement) ===');
  const meervoudig = queryResult.matches?.filter(m => 
    String(m.metadata?.text || '').toLowerCase().includes('meervoudig depot')
  );
  console.log(`Matches met "Meervoudig depot": ${meervoudig?.length || 0}`);
}

findAll22().catch(console.error);
