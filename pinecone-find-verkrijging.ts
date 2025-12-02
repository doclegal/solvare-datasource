import { Pinecone } from '@pinecone-database/pinecone';

async function findVerkrijging() {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  const pc = new Pinecone({ apiKey });
  const correctHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
  const index = pc.index('rechtstreeks', correctHost);
  
  // Search for "Verkrijging van het recht" in all records
  console.log('=== Zoeken naar "Verkrijging van het recht" ===\n');
  
  const queryResult = await index.namespace('laws-current').query({
    vector: new Array(1024).fill(0.01),
    topK: 200,
    includeMetadata: true,
    filter: {
      bwb_id: { $eq: 'BWBV0001716' }
    }
  });
  
  console.log(`Totaal records voor dit verdrag: ${queryResult.matches?.length}\n`);
  
  // Search for Verkrijging
  const verkrijgingMatches = queryResult.matches?.filter(m => 
    String(m.metadata?.text || '').toLowerCase().includes('verkrijging van het recht') ||
    String(m.metadata?.section_title || '').toLowerCase().includes('verkrijging')
  );
  
  if (verkrijgingMatches && verkrijgingMatches.length > 0) {
    console.log(`Gevonden ${verkrijgingMatches.length} matches met "Verkrijging":\n`);
    verkrijgingMatches.forEach(m => {
      console.log(`  ID: ${m.id}`);
      console.log(`  article_number: ${m.metadata?.article_number}`);
      console.log(`  section_title: ${m.metadata?.section_title}`);
      console.log(`  structure_path: ${m.metadata?.structure_path}`);
      console.log(`  Tekst: ${String(m.metadata?.text || '').substring(0, 300)}...\n`);
    });
  } else {
    console.log('"Verkrijging van het recht" NIET GEVONDEN in de database!\n');
  }
  
  // Show unique section_titles to understand what IS in the database
  console.log('\n=== Alle unieke section_titles in dit verdrag ===');
  const sectionTitles = [...new Set(queryResult.matches?.map(m => m.metadata?.section_title))].filter(Boolean).sort();
  sectionTitles.forEach(t => console.log(`  - ${t}`));
  
  // Show unique structure_paths
  console.log('\n=== Alle unieke structure_paths ===');
  const structurePaths = [...new Set(queryResult.matches?.map(m => m.metadata?.structure_path))].filter(Boolean).sort();
  structurePaths.forEach(p => console.log(`  - ${p}`));
  
  // Show all artikel 2.x
  console.log('\n\n=== Alle artikel 2.x in database ===');
  const artikel2 = queryResult.matches?.filter(m => 
    String(m.metadata?.article_number || '').startsWith('2.')
  ).sort((a, b) => {
    const numA = parseFloat(String(a.metadata?.article_number || '0'));
    const numB = parseFloat(String(b.metadata?.article_number || '0'));
    return numA - numB;
  });
  
  // Group by article number
  const byArticle = new Map<string, typeof artikel2>();
  artikel2?.forEach(m => {
    const artNum = String(m.metadata?.article_number);
    if (!byArticle.has(artNum)) byArticle.set(artNum, []);
    byArticle.get(artNum)!.push(m);
  });
  
  console.log(`\nUnieke artikel 2.x nummers: ${byArticle.size}`);
  byArticle.forEach((records, artNum) => {
    const sectionTitles = [...new Set(records.map(r => r.metadata?.section_title))];
    console.log(`  ${artNum}: ${records.length} records - ${sectionTitles.join(', ')}`);
  });
}

findVerkrijging().catch(console.error);
