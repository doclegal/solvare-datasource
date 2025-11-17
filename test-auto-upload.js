#!/usr/bin/env node

// Test de nieuwe automatische Pinecone upload functionaliteit

const baseUrl = 'http://localhost:5000';

// Test met 2 ECLI's voor snelle validatie
const testECLIs = [
  'ECLI:NL:HR:1990:ZC8537',  // Auteursrecht fotografie
  'ECLI:NL:HR:1953:76',       // Hyster Karry Krane
];

async function testAutoUpload() {
  console.log('🧪 TEST: Automatische Pinecone Upload');
  console.log('=====================================\n');
  
  // Step 1: Fetch metadata voor test ECLIs
  console.log('📥 Stap 1: Metadata ophalen...');
  const contentResponse = await fetch(`${baseUrl}/api/rechtspraak/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eclis: testECLIs })
  });
  
  const contentData = await contentResponse.json();
  console.log(`✅ ${contentData.records.length} records opgehaald\n`);
  
  // Step 2: Start AI enrichment met automatische Pinecone upload
  console.log('🤖 Stap 2: AI enrichment + automatische Pinecone upload...');
  console.log('-----------------------------------------------------------');
  
  const enrichResponse = await fetch(`${baseUrl}/api/rechtspraak/enrich-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eclis: testECLIs,
      originalRecords: contentData.records
    })
  });
  
  // Read SSE stream
  const reader = enrichResponse.body.getReader();
  const decoder = new TextDecoder();
  
  let enrichmentStats = null;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        
        if (data.type === 'complete') {
          enrichmentStats = data;
          console.log('\n✅ ENRICHMENT VOLTOOID!');
          console.log(`   AI verrijkt: ${data.successful}/${data.total}`);
          console.log(`   Pinecone uploaded: ${data.pinecone.uploaded}`);
          console.log(`   Pinecone errors: ${data.pinecone.errors}`);
          console.log(`   Namespace: ${data.pinecone.namespace}`);
        } else if (data.type === 'error') {
          console.error('❌ ERROR:', data.message);
        } else {
          // Show progress messages
          const icon = data.type === 'success' ? '✓' : data.type === 'error' ? '✗' : '⋯';
          console.log(`  ${icon} ${data.message}`);
        }
      }
    }
  }
  
  // Validate results
  console.log('\n🔍 Validatie:');
  if (enrichmentStats) {
    const allUploaded = enrichmentStats.pinecone.uploaded === enrichmentStats.successful;
    const noErrors = enrichmentStats.pinecone.errors === 0;
    
    if (allUploaded && noErrors) {
      console.log('✅ ALLE CHECKS GESLAAGD!');
      console.log('   - Alle AI-verrijkte records zijn automatisch naar Pinecone geüpload');
      console.log('   - Geen upload fouten');
      console.log('\n🎉 Automatische upload werkt perfect!');
    } else {
      console.log('⚠️  Waarschuwing:');
      if (!allUploaded) {
        console.log(`   - Niet alle records zijn geüpload (${enrichmentStats.pinecone.uploaded}/${enrichmentStats.successful})`);
      }
      if (!noErrors) {
        console.log(`   - ${enrichmentStats.pinecone.errors} upload fouten`);
      }
    }
  } else {
    console.log('❌ Geen enrichment stats ontvangen');
  }
}

testAutoUpload().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
