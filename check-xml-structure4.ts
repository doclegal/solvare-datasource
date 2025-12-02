import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

async function checkXmlStructure() {
  const bwbId = 'BWBV0001716';
  
  const url = `https://wetten.overheid.nl/${bwbId}/2021-09-02/xml`;
  const response = await axios.get(url, { timeout: 30000 });
  const xmlContent = response.data;
  
  console.log(`XML grootte: ${xmlContent.length} tekens\n`);
  
  // Parse the XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });
  
  const parsed = parser.parse(xmlContent);
  
  // Show top-level structure
  console.log('=== TOP-LEVEL STRUCTUUR ===');
  console.log('Keys:', Object.keys(parsed).filter(k => !k.startsWith('@_')).join(', '));
  
  const wetgeving = parsed['wetgeving'];
  if (wetgeving) {
    console.log('\n=== WETGEVING STRUCTUUR ===');
    console.log('Keys:', Object.keys(wetgeving).filter(k => !k.startsWith('@_')).join(', '));
    
    // Navigate deeper
    for (const key of Object.keys(wetgeving)) {
      if (key.startsWith('@_')) continue;
      const child = wetgeving[key];
      if (typeof child === 'object' && child !== null) {
        const childKeys = Object.keys(child).filter(k => !k.startsWith('@_'));
        console.log(`\n  ${key}:`);
        console.log(`    Keys: ${childKeys.slice(0, 15).join(', ')}${childKeys.length > 15 ? '...' : ''}`);
      }
    }
  }
  
  // Search entire tree for "Verkrijging"
  console.log('\n\n=== ZOEKEN IN HELE XML NAAR "Verkrijging" ===');
  
  function searchText(node: any, searchTerm: string, path: string = ''): string[] {
    if (!node) return [];
    
    const found: string[] = [];
    
    if (typeof node === 'string' && node.toLowerCase().includes(searchTerm.toLowerCase())) {
      found.push(`${path}: "${node.substring(0, 100)}..."`);
    }
    
    if (typeof node === 'object') {
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) {
          for (let i = 0; i < child.length; i++) {
            found.push(...searchText(child[i], searchTerm, `${path}/${key}[${i}]`));
          }
        } else {
          found.push(...searchText(child, searchTerm, `${path}/${key}`));
        }
      }
    }
    
    return found;
  }
  
  const verkrijgingMatches = searchText(parsed, 'Verkrijging van het recht');
  console.log(`Gevonden ${verkrijgingMatches.length} matches:`);
  verkrijgingMatches.slice(0, 10).forEach(m => console.log(`  ${m.substring(0, 200)}`));
  
  // Also check raw XML for the text
  console.log('\n\n=== CHECK RAW XML ===');
  const verkrijgingIndex = xmlContent.indexOf('Verkrijging van het recht');
  if (verkrijgingIndex >= 0) {
    console.log('Gevonden in raw XML op positie:', verkrijgingIndex);
    console.log('Context:', xmlContent.substring(verkrijgingIndex - 100, verkrijgingIndex + 200));
  } else {
    console.log('"Verkrijging van het recht" NIET gevonden in raw XML!');
    
    // Check for partial matches
    const partial = xmlContent.indexOf('Verkrijging');
    if (partial >= 0) {
      console.log('\n"Verkrijging" (partial) gevonden op positie:', partial);
      console.log('Context:', xmlContent.substring(partial - 50, partial + 100));
    }
  }
}

checkXmlStructure().catch(console.error);
