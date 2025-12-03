import { Pinecone } from '@pinecone-database/pinecone';

async function checkAwbInPinecone() {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    console.error('PINECONE_API_KEY not set');
    process.exit(1);
  }
  
  const client = new Pinecone({ apiKey });
  const indexHost = 'rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io';
  
  const indexName = indexHost.split('.')[0];
  const index = client.index(indexName, indexHost);
  const namespace = index.namespace('laws-current');
  
  console.log('Checking AWB (BWBR0005537) in Pinecone...\n');
  
  // Get index stats
  const stats = await index.describeIndexStats();
  console.log('Index stats:', JSON.stringify(stats, null, 2));
  
  // Query for all AWB articles using list
  console.log('\nListing all AWB vectors...');
  
  const allAwbVectors: string[] = [];
  let paginationToken: string | undefined = undefined;
  
  do {
    const listResult = await namespace.listPaginated({
      prefix: 'BWBR0005537#',
      limit: 100,
      paginationToken,
    });
    
    if (listResult.vectors) {
      for (const v of listResult.vectors) {
        allAwbVectors.push(v.id || '');
      }
    }
    
    paginationToken = listResult.pagination?.next;
  } while (paginationToken);
  
  console.log(`\nTotal AWB vectors in Pinecone: ${allAwbVectors.length}`);
  
  // Parse article numbers from vector IDs
  const articleNumbers: string[] = [];
  const vectorIdPattern = /BWBR0005537#art([^#]+)/;
  
  for (const id of allAwbVectors) {
    const match = id.match(vectorIdPattern);
    if (match) {
      articleNumbers.push(match[1]);
    }
  }
  
  // Deduplicate (some articles may have multiple chunks)
  const uniqueArticles = [...new Set(articleNumbers)].sort((a, b) => {
    const [aMain, aSub] = a.split(':').map(x => parseFloat(x) || 0);
    const [bMain, bSub] = b.split(':').map(x => parseFloat(x) || 0);
    if (aMain !== bMain) return aMain - bMain;
    return aSub - bSub;
  });
  
  console.log(`\nUnique articles in Pinecone: ${uniqueArticles.length}`);
  
  // Group by chapter
  const byChapter: Record<string, string[]> = {};
  for (const art of uniqueArticles) {
    const chapter = art.split(':')[0];
    if (!byChapter[chapter]) byChapter[chapter] = [];
    byChapter[chapter].push(art);
  }
  
  console.log('\n=== ARTICLES BY CHAPTER ===');
  for (const [ch, arts] of Object.entries(byChapter).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    console.log(`\nHoofdstuk ${ch}: ${arts.length} artikelen`);
    console.log(`  ${arts.join(', ')}`);
  }
  
  // Check for missing chapters
  console.log('\n=== MISSING ANALYSIS ===');
  const expectedChapters = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  for (const ch of expectedChapters) {
    if (!byChapter[ch]) {
      console.log(`Hoofdstuk ${ch}: VOLLEDIG ONTBREEKT`);
    }
  }
  
  // Check specific missing articles
  const checkArticles = [
    '7:1', '7:2', '7:3',
    '8:18', '8:19', '8:20', '8:69', '8:69a',
    '5:1', '5:11', '5:12',
    '6:1', '6:2'
  ];
  
  console.log('\nSpecifieke artikelen check:');
  for (const art of checkArticles) {
    const found = uniqueArticles.includes(art);
    console.log(`  Artikel ${art}: ${found ? 'GEVONDEN' : 'ONTBREEKT'}`);
  }
  
  // Show first and last articles in each chapter
  console.log('\n=== EERSTE EN LAATSTE ARTIKEL PER HOOFDSTUK ===');
  for (const [ch, arts] of Object.entries(byChapter).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    console.log(`  Hoofdstuk ${ch}: ${arts[0]} ... ${arts[arts.length - 1]}`);
  }
}

checkAwbInPinecone().catch(console.error);
