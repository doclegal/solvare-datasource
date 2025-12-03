import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '_text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

async function analyzeAwb() {
  const bwbId = 'BWBR0005537'; // Algemene wet bestuursrecht
  const date = new Date().toISOString().split('T')[0];
  const url = `https://repository.officiele-overheidspublicaties.nl/bwb/${bwbId}/geldend/${date}/${bwbId}.xml`;
  
  console.log(`Downloading AWB from: ${url}`);
  
  const response = await axios.get(url, {
    timeout: 60000,
    headers: { 'Accept': 'application/xml, text/xml' },
  });
  
  const xmlContent = response.data;
  console.log(`Downloaded ${xmlContent.length} bytes`);
  
  const parsed = xmlParser.parse(xmlContent);
  
  // Navigate to wettekst
  let root = parsed['toestand'] || parsed;
  const wetgeving = root['wetgeving'] || root['wet'] || root;
  const wetBesluit = wetgeving['wet-besluit'] || wetgeving['regeling'] || wetgeving;
  const wettekst = wetBesluit['wettekst'] || wetBesluit['regeling-tekst'] || wetBesluit;
  
  console.log('\n=== TOP LEVEL STRUCTURE ===');
  console.log('Keys at wettekst level:', Object.keys(wettekst).filter(k => !k.startsWith('@_') && k !== '_text'));
  
  // Analyze hoofdstukken
  console.log('\n=== HOOFDSTUKKEN ANALYSIS ===');
  const hoofdstukken = wettekst['hoofdstuk'];
  const hoofdstukArray = Array.isArray(hoofdstukken) ? hoofdstukken : (hoofdstukken ? [hoofdstukken] : []);
  console.log(`Found ${hoofdstukArray.length} hoofdstukken at top level`);
  
  for (const hfst of hoofdstukArray) {
    const kop = hfst['kop'] || {};
    const nr = kop['nr'] || hfst['@_nr'] || '?';
    const titel = kop['titel'] || '';
    const artikelen = countArtikelen(hfst);
    const afdelingen = hfst['afdeling'] ? (Array.isArray(hfst['afdeling']) ? hfst['afdeling'].length : 1) : 0;
    const titels = hfst['titel'] ? (Array.isArray(hfst['titel']) ? hfst['titel'].length : 1) : 0;
    const paragrafen = hfst['paragraaf'] ? (Array.isArray(hfst['paragraaf']) ? hfst['paragraaf'].length : 1) : 0;
    
    console.log(`\nHoofdstuk ${nr}: ${typeof titel === 'string' ? titel : titel._text || JSON.stringify(titel)}`);
    console.log(`  - Direct children: ${Object.keys(hfst).filter(k => !k.startsWith('@_') && k !== '_text').join(', ')}`);
    console.log(`  - Afdelingen: ${afdelingen}, Titels: ${titels}, Paragrafen: ${paragrafen}`);
    console.log(`  - Total artikelen found (recursive): ${artikelen}`);
    
    // Check deeper structure for missing articles
    analyzeDeepStructure(hfst, `Hoofdstuk ${nr}`, 1);
  }
  
  // Also check for any articles directly in wettekst (outside hoofdstukken)
  const directArticles = wettekst['artikel'] ? (Array.isArray(wettekst['artikel']) ? wettekst['artikel'].length : 1) : 0;
  console.log(`\nDirect artikelen in wettekst (outside hoofdstukken): ${directArticles}`);
}

function countArtikelen(node: any): number {
  if (!node || typeof node !== 'object') return 0;
  
  let count = 0;
  
  if (node['artikel']) {
    const arts = Array.isArray(node['artikel']) ? node['artikel'] : [node['artikel']];
    count += arts.length;
  }
  
  // Recurse into children
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '_text' || key === 'artikel') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        count += countArtikelen(item);
      }
    } else if (typeof child === 'object') {
      count += countArtikelen(child);
    }
  }
  
  return count;
}

function analyzeDeepStructure(node: any, path: string, depth: number) {
  if (!node || typeof node !== 'object' || depth > 4) return;
  
  // Check for afdelingen
  if (node['afdeling']) {
    const afdelingen = Array.isArray(node['afdeling']) ? node['afdeling'] : [node['afdeling']];
    for (const afd of afdelingen) {
      const kop = afd['kop'] || {};
      const nr = kop['nr'] || afd['@_nr'] || '?';
      const titel = kop['titel'] || '';
      const titelStr = typeof titel === 'string' ? titel : titel._text || '';
      const artCount = countArtikelen(afd);
      console.log(`${'  '.repeat(depth)}Afdeling ${nr} (${titelStr.substring(0, 40)}...): ${artCount} artikelen`);
      analyzeDeepStructure(afd, `${path} > Afdeling ${nr}`, depth + 1);
    }
  }
  
  // Check for titels
  if (node['titel'] && typeof node['titel'] === 'object') {
    const titels = Array.isArray(node['titel']) ? node['titel'] : [node['titel']];
    for (const tit of titels) {
      if (typeof tit === 'object' && (tit['artikel'] || tit['afdeling'] || tit['paragraaf'] || tit['kop'])) {
        const kop = tit['kop'] || {};
        const nr = kop['nr'] || tit['@_nr'] || '?';
        const naam = kop['titel'] || '';
        const naamStr = typeof naam === 'string' ? naam : naam._text || '';
        const artCount = countArtikelen(tit);
        console.log(`${'  '.repeat(depth)}Titel ${nr} (${naamStr.substring(0, 40)}...): ${artCount} artikelen`);
        analyzeDeepStructure(tit, `${path} > Titel ${nr}`, depth + 1);
      }
    }
  }
  
  // Check for paragrafen
  if (node['paragraaf']) {
    const paragrafen = Array.isArray(node['paragraaf']) ? node['paragraaf'] : [node['paragraaf']];
    for (const para of paragrafen) {
      const kop = para['kop'] || {};
      const nr = kop['nr'] || para['@_nr'] || '?';
      const artCount = countArtikelen(para);
      if (artCount > 0) {
        console.log(`${'  '.repeat(depth)}§ ${nr}: ${artCount} artikelen`);
      }
    }
  }
}

analyzeAwb().catch(console.error);
