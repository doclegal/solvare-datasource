import { Pinecone } from '@pinecone-database/pinecone';

async function checkAfterFix() {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  const pc = new Pinecone({ apiKey });
  const correctHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
  const index = pc.index('rechtstreeks', correctHost);
  
  console.log('=== CHECK NA HERNIEUWDE UPLOAD ===\n');
  
  // Query for all artikel 2.2
  const queryResult = await index.namespace('laws-current').query({
    vector: new Array(1024).fill(0.01),
    topK: 50,
    includeMetadata: true,
    filter: {
      bwb_id: { $eq: 'BWBV0001716' },
      article_number: { $eq: '2.2' }
    }
  });
  
  console.log(`Gevonden ${queryResult.matches?.length} records met article_number "2.2"\n`);
  
  queryResult.matches?.forEach((m, i) => {
    console.log(`[${i + 1}] ID: ${m.id}`);
    console.log(`    section_title: "${m.metadata?.section_title}"`);
    console.log(`    structure_path: "${m.metadata?.structure_path}"`);
    console.log(`    boek_nummer: "${m.metadata?.boek_nummer || 'N/A'}"`);
    console.log(`    boek_titel: "${m.metadata?.boek_titel || 'N/A'}"`);
    console.log(`    Tekst (50 chars): ${String(m.metadata?.text || '').substring(0, 50)}...\n`);
  });
  
  // Specifically look for "Verkrijging van het recht"
  console.log('\n=== ZOEKEN NAAR "Verkrijging van het recht" ===');
  
  const verkrijging = queryResult.matches?.filter(m => 
    String(m.metadata?.section_title || '').includes('Verkrijging') ||
    String(m.metadata?.text || '').includes('Verkrijging van het recht')
  );
  
  if (verkrijging && verkrijging.length > 0) {
    console.log(`\n✅ GEVONDEN! ${verkrijging.length} records met "Verkrijging van het recht":\n`);
    verkrijging.forEach(m => {
      console.log(`  ID: ${m.id}`);
      console.log(`  section_title: "${m.metadata?.section_title}"`);
      console.log(`  boek_titel: "${m.metadata?.boek_titel}"`);
    });
  } else {
    console.log('\n❌ "Verkrijging van het recht" nog steeds niet gevonden');
  }
  
  // Count total records for this treaty
  console.log('\n\n=== TOTAAL AANTAL RECORDS ===');
  
  const totalQuery = await index.namespace('laws-current').query({
    vector: new Array(1024).fill(0.01),
    topK: 1000,
    includeMetadata: false,
    filter: {
      bwb_id: { $eq: 'BWBV0001716' }
    }
  });
  
  console.log(`Totaal aantal records voor BWBV0001716: ${totalQuery.matches?.length}`);
}

checkAfterFix().catch(console.error);
