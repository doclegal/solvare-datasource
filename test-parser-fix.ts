import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

// Import the parser function
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

interface HierarchyContext {
  boekNummer?: string;
  boekTitel?: string;
  titelNummer?: string;
  titelNaam?: string;
  afdelingNummer?: string;
  afdelingNaam?: string;
  paragraafNummer?: string;
  paragraafNaam?: string;
}

interface ArticleWithHierarchy {
  number: string;
  title: string;
  content: string;
  paragraphs: { number: string; content: string }[];
  hierarchy: HierarchyContext;
}

function toSafeString(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return val.toString();
  if (val['#text']) return toSafeString(val['#text']);
  if (val._text) return toSafeString(val._text);
  return '';
}

function extractKopInfo(node: any): { nummer: string; naam: string } {
  const kop = node['kop'] || {};
  const nr = kop['nr'] || node['@_nr'] || node['nr'] || '';
  const nummer = toSafeString(nr);
  const titel = kop['titel'] || kop['title'] || kop['label'] || '';
  const naam = toSafeString(titel);
  return { nummer, naam };
}

function extractAllText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return node.toString();
  let text = '';
  if (node['#text']) text += node['#text'] + ' ';
  if (node._text) text += node._text + ' ';
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text' || key === '_text') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) text += extractAllText(item) + ' ';
    } else {
      text += extractAllText(child) + ' ';
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function parseArticleWithHierarchy(node: any, hierarchy: HierarchyContext): ArticleWithHierarchy | null {
  if (!node) return null;
  const kop = node['kop'] || {};
  const nr = kop['nr'] || node['@_nr'] || node['nr'];
  const number = toSafeString(nr);
  const tit = kop['titel'] || kop['title'] || '';
  const title = toSafeString(tit);
  let content = '';
  const paragraphs: { number: string; content: string }[] = [];
  const leden = node['lid'] || [];
  const ledenArray = Array.isArray(leden) ? leden : (leden ? [leden] : []);
  for (const lid of ledenArray) {
    const lidNr = lid['@_nr'] || lid['lidnr'] || '';
    const lidContent = extractAllText(lid);
    if (lidContent) {
      paragraphs.push({
        number: typeof lidNr === 'string' ? lidNr : lidNr?.['#text'] || '',
        content: lidContent,
      });
    }
  }
  if (paragraphs.length === 0) {
    content = extractAllText(node);
  } else {
    content = paragraphs.map(p => p.content).join('\n');
  }
  if (!content && paragraphs.length === 0) return null;
  return { number: number.trim(), title: title.trim(), content, paragraphs, hierarchy: { ...hierarchy } };
}

function findAllArticlesWithHierarchy(
  node: any,
  context: HierarchyContext = {},
  articles: ArticleWithHierarchy[] = []
): ArticleWithHierarchy[] {
  if (!node || typeof node !== 'object') return articles;
  let currentContext = { ...context };

  // Titeldeel
  if (node['titeldeel']) {
    const titeldelen = Array.isArray(node['titeldeel']) ? node['titeldeel'] : [node['titeldeel']];
    for (const titeldeel of titeldelen) {
      const info = extractKopInfo(titeldeel);
      const titelContext = { ...currentContext, titelNummer: info.nummer, titelNaam: info.naam };
      findAllArticlesWithHierarchy(titeldeel, titelContext, articles);
    }
  }

  // Hoofdstuk
  if (node['hoofdstuk']) {
    const hoofdstukken = Array.isArray(node['hoofdstuk']) ? node['hoofdstuk'] : [node['hoofdstuk']];
    for (const hoofdstuk of hoofdstukken) {
      const info = extractKopInfo(hoofdstuk);
      const hContext = { ...currentContext, afdelingNummer: info.nummer, afdelingNaam: info.naam };
      findAllArticlesWithHierarchy(hoofdstuk, hContext, articles);
    }
  }

  // Artikel
  if (node['artikel']) {
    const artikelen = node['artikel'];
    const artikelArray = Array.isArray(artikelen) ? artikelen : [artikelen];
    for (const art of artikelArray) {
      const articleData = parseArticleWithHierarchy(art, currentContext);
      if (articleData) articles.push(articleData);
    }
  }

  // Recursief
  const processedKeys = new Set(['titeldeel', 'hoofdstuk', 'artikel']);
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text' || processedKeys.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) findAllArticlesWithHierarchy(item, currentContext, articles);
    } else if (typeof child === 'object') {
      findAllArticlesWithHierarchy(child, currentContext, articles);
    }
  }

  return articles;
}

async function testParser() {
  const bwbId = 'BWBV0001716';
  const url = `https://wetten.overheid.nl/${bwbId}/2021-09-02/xml`;
  
  console.log(`=== TEST PARSER FIX voor ${bwbId} ===\n`);
  
  const response = await axios.get(url, { timeout: 30000 });
  const xmlContent = response.data;
  const parsed = xmlParser.parse(xmlContent);
  
  // Use the new logic
  let root = parsed['toestand'] || parsed;
  const wetgeving = root['wetgeving'] || root['wet'] || root;
  const verdrag = wetgeving['verdrag'];
  
  let articles: ArticleWithHierarchy[] = [];
  
  if (verdrag) {
    console.log('Detected treaty structure (verdrag)\n');
    
    const verdragteksten = verdrag['verdragtekst'];
    const verdragtekstArray = Array.isArray(verdragteksten) ? verdragteksten : (verdragteksten ? [verdragteksten] : []);
    
    console.log(`Found ${verdragtekstArray.length} verdragtekst sections\n`);
    
    for (let i = 0; i < verdragtekstArray.length; i++) {
      const verdragtekst = verdragtekstArray[i];
      const wettekst = verdragtekst['wettekst'] || verdragtekst['regeling-tekst'] || verdragtekst;
      
      const kop = verdragtekst['kop'] || {};
      const partLabel = kop['label'] || kop['titel'] || `Deel ${i + 1}`;
      const partLabelStr = typeof partLabel === 'object' ? (partLabel['#text'] || partLabel['_text'] || '') : String(partLabel);
      
      console.log(`=== Verdragtekst ${i + 1}: ${partLabelStr} ===`);
      
      const partContext: HierarchyContext = {
        boekNummer: `verdragtekst${i + 1}`,
        boekTitel: partLabelStr,
      };
      
      const partArticles = findAllArticlesWithHierarchy(wettekst, partContext);
      console.log(`  Found ${partArticles.length} articles\n`);
      
      // Look for artikel 2.2 in this part
      const art22 = partArticles.filter(a => a.number === '2.2');
      if (art22.length > 0) {
        console.log(`  Artikel 2.2 gevonden:`);
        art22.forEach(a => {
          console.log(`    - Title: "${a.title}"`);
          console.log(`    - Hierarchy: boek=${a.hierarchy.boekNummer}, titel=${a.hierarchy.titelNummer}`);
        });
        console.log('');
      }
      
      articles.push(...partArticles);
    }
  }
  
  console.log(`\n=== TOTAAL: ${articles.length} artikelen gevonden ===\n`);
  
  // Find all artikel 2.2
  const all22 = articles.filter(a => a.number === '2.2');
  console.log(`\nAlle artikel 2.2 (${all22.length}):`);
  all22.forEach(a => {
    console.log(`  - "${a.title}" (boek: ${a.hierarchy.boekNummer}, titel: ${a.hierarchy.titelNummer})`);
  });
  
  // Specifically look for "Verkrijging van het recht"
  const verkrijging = articles.filter(a => a.title.includes('Verkrijging'));
  console.log(`\nArtikelen met "Verkrijging" in titel (${verkrijging.length}):`);
  verkrijging.forEach(a => {
    console.log(`  - Artikel ${a.number}: "${a.title}"`);
    console.log(`    Boek: ${a.hierarchy.boekNummer}, Titel: ${a.hierarchy.titelNummer}`);
  });
}

testParser().catch(console.error);
