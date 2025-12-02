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
  const wetgeving = parsed['wetgeving'] || parsed['wet'] || parsed;
  const wetBesluit = wetgeving['wet-besluit'];
  
  console.log('=== WET-BESLUIT STRUCTUUR ===\n');
  console.log('Top-level keys:', Object.keys(wetBesluit).filter(k => !k.startsWith('@_')).join(', '));
  
  // Check for bijlage (annex) - this is where Uitvoeringsreglement etc. might be
  if (wetBesluit['bijlage']) {
    const bijlagen = Array.isArray(wetBesluit['bijlage']) ? wetBesluit['bijlage'] : [wetBesluit['bijlage']];
    console.log(`\n=== ${bijlagen.length} BIJLAGEN GEVONDEN ===\n`);
    
    for (let i = 0; i < bijlagen.length; i++) {
      const b = bijlagen[i];
      const kop = b['kop'] || {};
      const label = kop['label'] || kop['titel'] || '(geen label)';
      console.log(`Bijlage ${i + 1}: ${typeof label === 'object' ? JSON.stringify(label) : label}`);
      
      // Check what's inside each bijlage
      const keys = Object.keys(b).filter(k => !k.startsWith('@_') && k !== 'kop');
      console.log(`  Bevat: ${keys.join(', ')}`);
      
      // Look for wettekst or regeling-tekst inside bijlage
      if (b['wettekst'] || b['regeling-tekst']) {
        const tekst = b['wettekst'] || b['regeling-tekst'];
        const tekstKeys = Object.keys(tekst).filter(k => !k.startsWith('@_'));
        console.log(`  wettekst/regeling-tekst keys: ${tekstKeys.join(', ')}`);
        
        // Count articles
        function countArticles(node: any): number {
          if (!node || typeof node !== 'object') return 0;
          let count = 0;
          
          if (node['artikel']) {
            const arts = Array.isArray(node['artikel']) ? node['artikel'] : [node['artikel']];
            count += arts.length;
          }
          
          for (const key of Object.keys(node)) {
            if (key.startsWith('@_') || key === 'artikel') continue;
            const child = node[key];
            if (Array.isArray(child)) {
              for (const item of child) {
                count += countArticles(item);
              }
            } else if (typeof child === 'object') {
              count += countArticles(child);
            }
          }
          
          return count;
        }
        
        const articleCount = countArticles(tekst);
        console.log(`  Aantal artikelen: ${articleCount}`);
      }
    }
  }
  
  // Check main wettekst
  if (wetBesluit['wettekst']) {
    console.log('\n=== HOOFD WETTEKST ===');
    const wettekst = wetBesluit['wettekst'];
    const keys = Object.keys(wettekst).filter(k => !k.startsWith('@_'));
    console.log('Keys:', keys.join(', '));
    
    // Count articles in main wettekst
    function countArticles(node: any): number {
      if (!node || typeof node !== 'object') return 0;
      let count = 0;
      
      if (node['artikel']) {
        const arts = Array.isArray(node['artikel']) ? node['artikel'] : [node['artikel']];
        count += arts.length;
      }
      
      for (const key of Object.keys(node)) {
        if (key.startsWith('@_') || key === 'artikel') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            count += countArticles(item);
          }
        } else if (typeof child === 'object') {
          count += countArticles(child);
        }
      }
      
      return count;
    }
    
    console.log(`Aantal artikelen in hoofd-wettekst: ${countArticles(wettekst)}`);
  }
  
  // Zoek specifiek naar artikel 2.2 met titel "Verkrijging van het recht"
  console.log('\n\n=== ZOEKEN NAAR "Verkrijging van het recht" ===');
  
  function findArticle(node: any, searchTitle: string, path: string = ''): string[] {
    if (!node || typeof node !== 'object') return [];
    
    const found: string[] = [];
    
    if (node['artikel']) {
      const arts = Array.isArray(node['artikel']) ? node['artikel'] : [node['artikel']];
      for (const art of arts) {
        const kop = art['kop'] || {};
        const nr = kop['nr'] || art['@_nr'] || '';
        const titel = kop['titel'] || '';
        const titelStr = typeof titel === 'object' ? JSON.stringify(titel) : String(titel);
        
        if (titelStr.toLowerCase().includes(searchTitle.toLowerCase())) {
          found.push(`${path} -> artikel ${nr}: ${titelStr}`);
        }
      }
    }
    
    for (const key of Object.keys(node)) {
      if (key.startsWith('@_') || key === 'artikel') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
          found.push(...findArticle(child[i], searchTitle, `${path}/${key}[${i}]`));
        }
      } else if (typeof child === 'object') {
        found.push(...findArticle(child, searchTitle, `${path}/${key}`));
      }
    }
    
    return found;
  }
  
  const verkrijging = findArticle(wetBesluit, 'Verkrijging');
  if (verkrijging.length > 0) {
    console.log('Gevonden:');
    verkrijging.forEach(v => console.log(`  ${v}`));
  } else {
    console.log('Niet gevonden in XML!');
  }
  
  // Zoek ook naar artikel nummer 2.2
  console.log('\n\n=== ALLE ARTIKELEN MET NUMMER 2.2 ===');
  
  function findArticleByNumber(node: any, artNr: string, path: string = ''): string[] {
    if (!node || typeof node !== 'object') return [];
    
    const found: string[] = [];
    
    if (node['artikel']) {
      const arts = Array.isArray(node['artikel']) ? node['artikel'] : [node['artikel']];
      for (const art of arts) {
        const kop = art['kop'] || {};
        const nr = kop['nr'] || art['@_nr'] || '';
        const nrStr = typeof nr === 'object' ? (nr['_text'] || nr['#text'] || JSON.stringify(nr)) : String(nr);
        
        if (nrStr.trim() === artNr) {
          const titel = kop['titel'] || '';
          const titelStr = typeof titel === 'object' ? (titel['_text'] || titel['#text'] || JSON.stringify(titel)) : String(titel);
          found.push(`${path} -> artikel ${nrStr}: ${titelStr}`);
        }
      }
    }
    
    for (const key of Object.keys(node)) {
      if (key.startsWith('@_') || key === 'artikel') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
          found.push(...findArticleByNumber(child[i], artNr, `${path}/${key}[${i}]`));
        }
      } else if (typeof child === 'object') {
        found.push(...findArticleByNumber(child, artNr, `${path}/${key}`));
      }
    }
    
    return found;
  }
  
  const art22 = findArticleByNumber(wetBesluit, '2.2');
  if (art22.length > 0) {
    console.log(`Gevonden ${art22.length} artikelen met nummer 2.2:`);
    art22.forEach(v => console.log(`  ${v}`));
  } else {
    console.log('Geen artikelen met nummer 2.2 gevonden!');
  }
}

checkXmlStructure().catch(console.error);
