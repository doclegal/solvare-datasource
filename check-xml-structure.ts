import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

async function checkXmlStructure() {
  const bwbId = 'BWBV0001716';
  
  console.log(`=== Analyseren XML-structuur van ${bwbId} ===\n`);
  
  // Fetch the XML from wetten.overheid.nl
  const url = `https://wetten.overheid.nl/xml.php?regelingID=${bwbId}`;
  
  try {
    const response = await axios.get(url, { timeout: 30000 });
    const xmlContent = response.data;
    
    console.log(`XML grootte: ${xmlContent.length} tekens\n`);
    
    // Parse the XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    
    const parsed = parser.parse(xmlContent);
    
    // Function to list all keys recursively (max depth)
    function getStructure(node: any, depth: number = 0, maxDepth: number = 4): string[] {
      if (!node || typeof node !== 'object' || depth > maxDepth) return [];
      
      const keys: string[] = [];
      const indent = '  '.repeat(depth);
      
      for (const key of Object.keys(node)) {
        if (key.startsWith('@_') || key === '_text' || key === '#text') continue;
        
        const child = node[key];
        
        if (Array.isArray(child)) {
          keys.push(`${indent}${key}[] (${child.length} items)`);
          if (child.length > 0) {
            keys.push(...getStructure(child[0], depth + 1, maxDepth));
          }
        } else if (typeof child === 'object') {
          keys.push(`${indent}${key}`);
          keys.push(...getStructure(child, depth + 1, maxDepth));
        } else {
          keys.push(`${indent}${key}: (text)`);
        }
      }
      
      return keys;
    }
    
    console.log('=== TOP-LEVEL STRUCTUUR ===\n');
    const structure = getStructure(parsed, 0, 5);
    console.log(structure.slice(0, 100).join('\n'));
    
    // Look specifically for document parts
    console.log('\n\n=== ZOEKEN NAAR ONDERDELEN VAN HET VERDRAG ===\n');
    
    const wetgeving = parsed['wetgeving'] || parsed['wet'] || parsed;
    const wetBesluit = wetgeving['wet-besluit'] || wetgeving['regeling'] || wetgeving;
    
    // Check for "bijlage" (annex)
    if (wetgeving['bijlage'] || wetBesluit['bijlage']) {
      console.log('GEVONDEN: bijlage (Annex)');
    }
    
    // Check for "verdragstekst" 
    if (wetgeving['verdragstekst'] || wetBesluit['verdragstekst']) {
      console.log('GEVONDEN: verdragstekst (Treaty text)');
    }
    
    // Check for regeling-tekst
    if (wetgeving['regeling-tekst'] || wetBesluit['regeling-tekst']) {
      console.log('GEVONDEN: regeling-tekst');
    }
    
    // Check for wettekst
    if (wetgeving['wettekst'] || wetBesluit['wettekst']) {
      console.log('GEVONDEN: wettekst');
    }
    
    // List all top-level keys in wet-besluit
    console.log('\n=== ALLE TOP-LEVEL ELEMENTEN IN WET-BESLUIT ===');
    if (wetBesluit) {
      const topKeys = Object.keys(wetBesluit).filter(k => !k.startsWith('@_') && k !== '_text');
      console.log(topKeys.join(', '));
    }
    
    // Check for "authentieke-tekst" or similar
    console.log('\n=== ZOEKEN NAAR SPECIFIEKE STRUCTUREN ===');
    
    function findKeyRecursive(node: any, targetKey: string, path: string = '', found: string[] = []): string[] {
      if (!node || typeof node !== 'object') return found;
      
      for (const key of Object.keys(node)) {
        if (key.toLowerCase().includes(targetKey.toLowerCase())) {
          found.push(`${path}/${key}`);
        }
        
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach((item, i) => findKeyRecursive(item, targetKey, `${path}/${key}[${i}]`, found));
        } else if (typeof child === 'object') {
          findKeyRecursive(child, targetKey, `${path}/${key}`, found);
        }
      }
      
      return found;
    }
    
    // Search for interesting structures
    const searchTerms = ['bijlage', 'protocol', 'uitvoering', 'reglement', 'authentiek', 'verdrag', 'wetgevend'];
    for (const term of searchTerms) {
      const found = findKeyRecursive(wetgeving, term);
      if (found.length > 0) {
        console.log(`\n"${term}" gevonden op:`);
        found.slice(0, 5).forEach(f => console.log(`  - ${f}`));
        if (found.length > 5) console.log(`  ... en ${found.length - 5} meer`);
      }
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

checkXmlStructure().catch(console.error);
