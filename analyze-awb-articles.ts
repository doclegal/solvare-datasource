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

interface ArticleInfo {
  number: string;
  chapter: string;
  section?: string;
  hasContent: boolean;
}

async function analyzeAwbArticles() {
  const bwbId = 'BWBR0005537';
  const date = new Date().toISOString().split('T')[0];
  const url = `https://repository.officiele-overheidspublicaties.nl/bwb/${bwbId}/geldend/${date}/${bwbId}.xml`;
  
  console.log(`Downloading AWB from: ${url}\n`);
  
  const response = await axios.get(url, {
    timeout: 60000,
    headers: { 'Accept': 'application/xml, text/xml' },
  });
  
  const xmlContent = response.data;
  const parsed = xmlParser.parse(xmlContent);
  
  let root = parsed['toestand'] || parsed;
  const wetgeving = root['wetgeving'] || root['wet'] || root;
  const wetBesluit = wetgeving['wet-besluit'] || wetgeving['regeling'] || wetgeving;
  const wettekst = wetBesluit['wettekst'] || wetBesluit['regeling-tekst'] || wetBesluit;
  
  const articles: ArticleInfo[] = [];
  const hoofdstukken = wettekst['hoofdstuk'];
  const hoofdstukArray = Array.isArray(hoofdstukken) ? hoofdstukken : (hoofdstukken ? [hoofdstukken] : []);
  
  for (const hfst of hoofdstukArray) {
    const kop = hfst['kop'] || {};
    const hfstNr = toSafeString(kop['nr'] || hfst['@_nr'] || '?');
    extractArticles(hfst, `Hoofdstuk ${hfstNr}`, '', articles);
  }
  
  // Group by chapter and print
  const byChapter: Record<string, ArticleInfo[]> = {};
  for (const art of articles) {
    const ch = art.chapter;
    if (!byChapter[ch]) byChapter[ch] = [];
    byChapter[ch].push(art);
  }
  
  console.log('=== ALL ARTICLES FOUND IN XML ===\n');
  let totalCount = 0;
  
  for (const [chapter, arts] of Object.entries(byChapter)) {
    console.log(`${chapter}: ${arts.length} artikelen`);
    const articleNumbers = arts.map(a => a.number).sort((a, b) => {
      // Sort by main number, then sub-number
      const [aMain, aSub] = a.split(':').map(x => parseFloat(x) || 0);
      const [bMain, bSub] = b.split(':').map(x => parseFloat(x) || 0);
      if (aMain !== bMain) return aMain - bMain;
      return aSub - bSub;
    });
    console.log(`  Artikelen: ${articleNumbers.join(', ')}\n`);
    totalCount += arts.length;
  }
  
  console.log(`\nTOTAL ARTICLES FOUND: ${totalCount}`);
  
  // Check for gaps
  console.log('\n=== CHECKING FOR GAPS ===\n');
  checkForGaps(articles);
}

function extractArticles(node: any, chapter: string, section: string, articles: ArticleInfo[]) {
  if (!node || typeof node !== 'object') return;
  
  // Check for afdeling/titel changes
  if (node['afdeling']) {
    const afdelingen = Array.isArray(node['afdeling']) ? node['afdeling'] : [node['afdeling']];
    for (const afd of afdelingen) {
      const kop = afd['kop'] || {};
      const nr = toSafeString(kop['nr'] || afd['@_nr'] || '?');
      extractArticles(afd, chapter, `Afdeling ${nr}`, articles);
    }
  }
  
  if (node['titeldeel']) {
    const titeldelen = Array.isArray(node['titeldeel']) ? node['titeldeel'] : [node['titeldeel']];
    for (const td of titeldelen) {
      const kop = td['kop'] || {};
      const nr = toSafeString(kop['nr'] || td['@_nr'] || '?');
      extractArticles(td, chapter, `Titel ${nr}`, articles);
    }
  }
  
  // Direct articles
  if (node['artikel']) {
    const arts = Array.isArray(node['artikel']) ? node['artikel'] : [node['artikel']];
    for (const art of arts) {
      const kop = art['kop'] || {};
      const nr = toSafeString(kop['nr'] || art['@_nr'] || '');
      const hasContent = !!extractText(art);
      
      articles.push({
        number: nr,
        chapter,
        section,
        hasContent,
      });
    }
  }
  
  // Recurse into other elements
  for (const key of Object.keys(node)) {
    if (['afdeling', 'titeldeel', 'artikel', '_text'].includes(key) || key.startsWith('@_')) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (typeof item === 'object') {
          extractArticles(item, chapter, section, articles);
        }
      }
    } else if (typeof child === 'object') {
      extractArticles(child, chapter, section, articles);
    }
  }
}

function extractText(node: any): string {
  if (!node || typeof node !== 'object') return typeof node === 'string' ? node : '';
  let text = node._text || '';
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_')) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        text += extractText(item);
      }
    } else {
      text += extractText(child);
    }
  }
  return text.trim();
}

function toSafeString(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return val.toString();
  if (val._text) return toSafeString(val._text);
  if (val['#text']) return toSafeString(val['#text']);
  return '';
}

function checkForGaps(articles: ArticleInfo[]) {
  // Check specific articles mentioned as missing
  const missingCheck = [
    '5:1', '5:2', '5:10', '5:20', '5:30', '5:31', '5:32',
    '6:1', '6:2', '6:5', '6:10', '6:20',
    '7:1', '7:2',
    '8:19', '8:20', '8:30', '8:40', '8:50', '8:60', '8:69', '8:69a'
  ];
  
  const foundNumbers = new Set(articles.map(a => a.number));
  
  console.log('Checking for specific articles mentioned as missing:');
  for (const artNr of missingCheck) {
    const found = foundNumbers.has(artNr);
    console.log(`  Artikel ${artNr}: ${found ? 'GEVONDEN' : 'NIET GEVONDEN'}`);
  }
  
  // Check article count per chapter
  console.log('\n\nArticle count per chapter:');
  const chapterArticles: Record<string, string[]> = {};
  for (const art of articles) {
    const mainChapter = art.number.split(':')[0];
    if (!chapterArticles[mainChapter]) chapterArticles[mainChapter] = [];
    chapterArticles[mainChapter].push(art.number);
  }
  
  for (const [ch, arts] of Object.entries(chapterArticles).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    console.log(`  Hoofdstuk ${ch}: ${arts.length} artikelen (${arts[0]} - ${arts[arts.length-1]})`);
  }
}

analyzeAwbArticles().catch(console.error);
