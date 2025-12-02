import { Pinecone } from '@pinecone-database/pinecone';

async function explorePinecone() {
  const apiKey = process.env.PINECONE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing PINECONE_API_KEY');
    return;
  }
  
  const pc = new Pinecone({ apiKey });
  const correctHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
  const index = pc.index('rechtstreeks', correctHost);
  
  // Explore laws-current namespace without filters
  console.log('=== Exploring laws-current namespace ===');
  try {
    // Query without filter to see what titles exist
    const results = await index.namespace('laws-current').query({
      vector: new Array(1024).fill(0.01),
      topK: 50,
      includeMetadata: true
    });
    
    console.log('Sample records:', results.matches?.length || 0);
    
    // Collect unique titles
    const titles = new Set<string>();
    results.matches?.forEach(m => {
      if (m.metadata?.title) {
        titles.add(String(m.metadata.title));
      }
    });
    
    console.log('\nUnique titles found:');
    Array.from(titles).forEach(t => console.log(`  - ${t}`));
    
    // Look for anything with "Benelux" or "intellectuele"
    console.log('\n\nRecords containing "Benelux" or "intellectuele eigendom":');
    results.matches?.forEach(m => {
      const title = String(m.metadata?.title || '');
      const text = String(m.metadata?.text || '');
      if (title.toLowerCase().includes('benelux') || 
          text.toLowerCase().includes('benelux') ||
          title.toLowerCase().includes('intellectuele') ||
          text.toLowerCase().includes('intellectuele eigendom')) {
        console.log(`\n  Title: ${title}`);
        console.log(`  article_number: ${m.metadata?.article_number}`);
        console.log(`  ID: ${m.id}`);
        console.log(`  Text preview: ${text.substring(0, 200)}...`);
      }
    });
    
    // Show first few records with their metadata structure
    console.log('\n\n=== Sample records with full metadata ===');
    results.matches?.slice(0, 3).forEach((m, i) => {
      console.log(`\n[Record ${i+1}]`);
      console.log('ID:', m.id);
      console.log('Metadata keys:', Object.keys(m.metadata || {}));
      console.log('Title:', m.metadata?.title);
      console.log('article_number:', m.metadata?.article_number);
      console.log('bwb_id:', m.metadata?.bwb_id);
    });
    
  } catch (error: any) {
    console.error('Error:', error.message);
  }
  
  // Try listing vectors to see IDs
  console.log('\n\n=== Listing vector IDs in laws-current ===');
  try {
    const listResult = await index.namespace('laws-current').listPaginated({
      limit: 20
    });
    console.log('Sample IDs:', listResult.vectors?.map(v => v.id));
  } catch (error: any) {
    console.error('List error:', error.message);
  }
}

explorePinecone().catch(console.error);
