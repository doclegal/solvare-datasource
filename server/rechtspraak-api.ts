import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import type { EcliRecord, PreparedRecord, SearchFilters } from '@shared/schema';
import civilSubcategories from './data/civil-subcategories.json';

const RECHTSPRAAK_BASE_URL = 'https://data.rechtspraak.nl/uitspraken';
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
});

interface RechtspraakSearchResponse {
  feed: {
    entry: any | any[];
    'opensearch:totalResults': number;
  };
}

export async function searchDecisions(filters: SearchFilters): Promise<{
  records: EcliRecord[];
  totalResults: number;
}> {
  const params = new URLSearchParams();
  
  // Add filters as query parameters
  // NOTE: Date filtering is temporarily disabled - the API returns 400 for date parameters
  // TODO: Research correct date parameter format from official documentation
  
  // Filter on Civielrecht or specific subcategory
  const subcategoryId = filters.civilSubcategory || 'all';
  const subcategory = civilSubcategories.find(cat => cat.id === subcategoryId);
  const subjectUri = subcategory?.value || 'http://psi.rechtspraak.nl/rechtsgebied#civielRecht';
  params.append('subject', subjectUri);
  
  // Always filter on Uitspraak (not Conclusie)
  params.append('type', 'Uitspraak');
  
  if (filters.court && filters.court !== 'all') {
    params.append('creator', filters.court);
  }
  
  // Always filter for full documents only
  params.append('return', 'DOC');
  
  // Pagination
  params.append('max', filters.batchSize.toString());
  params.append('from', filters.from.toString());
  
  const url = `${RECHTSPRAAK_BASE_URL}/zoeken?${params.toString()}`;
  
  // Log the request for debugging
  console.log('[Rechtspraak API] Request URL:', url);
  console.log('[Rechtspraak API] Filters:', filters);
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/xml',
      },
      timeout: 30000,
    });

    const data = parser.parse(response.data) as RechtspraakSearchResponse;
    
    console.log('[Rechtspraak API] Response status:', response.status);
    console.log('[Rechtspraak API] Total results:', data.feed?.['opensearch:totalResults'] || 0);
    console.log('[Rechtspraak API] Entries count:', Array.isArray(data.feed?.entry) ? data.feed.entry.length : (data.feed?.entry ? 1 : 0));
    
    if (!data.feed) {
      return { records: [], totalResults: 0 };
    }

    const totalResults = data.feed['opensearch:totalResults'] || 0;
    
    // Handle both single entry and multiple entries
    let entries = data.feed.entry;
    if (!entries) {
      return { records: [], totalResults: 0 };
    }
    
    if (!Array.isArray(entries)) {
      entries = [entries];
    }

    const records: EcliRecord[] = entries.map((entry: any) => {
      const ecli = entry.id || '';
      const title = entry.title?.['#text'] || entry.title || 'Geen titel';
      const summary = entry.summary || '';
      
      // Extract court from ECLI (e.g., ECLI:NL:HR:2024:123 -> HR = Hoge Raad)
      const ecliParts = ecli.split(':');
      let court = 'Onbekend';
      if (ecliParts.length >= 3) {
        const courtCode = ecliParts[2];
        court = getCourtName(courtCode);
      }
      
      // Extract date
      let decisionDate = '';
      if (entry.updated) {
        decisionDate = entry.updated.split('T')[0];
      } else if (entry.published) {
        decisionDate = entry.published.split('T')[0];
      }
      
      return {
        ecli,
        title,
        court,
        decisionDate,
      };
    });

    return { records, totalResults };
  } catch (error: any) {
    console.error('Error searching Rechtspraak API:', error.message);
    throw new Error(`Fout bij ophalen uitspraken: ${error.message}`);
  }
}

export async function fetchDecisionContent(ecli: string): Promise<PreparedRecord> {
  const url = `${RECHTSPRAAK_BASE_URL}/content?id=${encodeURIComponent(ecli)}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/xml',
      },
      timeout: 30000,
    });

    const data = parser.parse(response.data);
    
    // Extract metadata from XML
    const rdf = data['open-rechtspraak']?.['rdf:RDF'] || {};
    const uitspraak = data['open-rechtspraak']?.uitspraak || data['open-rechtspraak']?.conclusie || {};
    
    // RDF can have rdf:Description as array or object - normalize it
    let descriptions = rdf['rdf:Description'];
    if (!Array.isArray(descriptions)) {
      descriptions = descriptions ? [descriptions] : [];
    }
    
    // Find the main description (usually the first one with most metadata)
    const mainDesc = descriptions.find((desc: any) => desc['dcterms:subject']) || descriptions[0] || {};
    
    // Extract title
    let title = 'Geen titel';
    if (mainDesc['dcterms:title']) {
      title = mainDesc['dcterms:title']['#text'] || mainDesc['dcterms:title'];
    }
    
    // Extract court
    let court = 'Onbekend';
    if (mainDesc['dcterms:creator']) {
      const creator = mainDesc['dcterms:creator'];
      if (creator['#text']) {
        court = creator['#text'];
      } else if (creator['@_rdfs:label']) {
        court = creator['@_rdfs:label'];
      } else if (creator['@_resourceIdentifier']) {
        court = getCourtName(creator['@_resourceIdentifier']);
      }
    }
    
    // Extract decision date
    let decisionDate = '';
    if (mainDesc['dcterms:date']) {
      decisionDate = mainDesc['dcterms:date']['#text'] || mainDesc['dcterms:date']['@_rdfs:label'] || mainDesc['dcterms:date'];
      if (typeof decisionDate === 'string' && decisionDate.includes('T')) {
        decisionDate = decisionDate.split('T')[0];
      }
    }
    
    // Extract legal area from mainDesc
    const legalArea: string[] = [];
    
    if (mainDesc['dcterms:subject']) {
      const subjects = Array.isArray(mainDesc['dcterms:subject']) 
        ? mainDesc['dcterms:subject'] 
        : [mainDesc['dcterms:subject']];
      
      subjects.forEach((subject: any) => {
        // Get the text content
        const label = subject['#text'] || subject;
        
        if (label && typeof label === 'string') {
          const trimmedLabel = label.trim();
          if (trimmedLabel && trimmedLabel !== 'Rechtsgebied') {
            legalArea.push(trimmedLabel);
          }
        }
      });
    }
    
    console.log(`[${ecli}] Legal area extracted:`, legalArea);
    
    // Extract procedure type from mainDesc
    let procedureType = 'Onbekend';
    if (mainDesc['psi:procedure']) {
      const procedures = Array.isArray(mainDesc['psi:procedure'])
        ? mainDesc['psi:procedure']
        : [mainDesc['psi:procedure']];
      
      // Take the first procedure type
      const procValue = procedures[0]['#text'] || procedures[0];
      if (procValue && typeof procValue === 'string') {
        procedureType = procValue;
      }
    }
    
    // Extract full text from uitspraak sections
    let fullText = '';
    if (uitspraak) {
      fullText = extractTextFromNode(uitspraak);
    }
    
    // If no text extracted, try to get summary
    if (!fullText && rdf['dcterms:abstract']) {
      fullText = rdf['dcterms:abstract']['#text'] || rdf['dcterms:abstract'];
    }
    
    const sourceUrl = `https://uitspraken.rechtspraak.nl/details?id=${ecli}`;
    
    return {
      ecli,
      title,
      court,
      decisionDate,
      legalArea: legalArea.length > 0 ? legalArea : ['Niet gespecificeerd'],
      procedureType,
      sourceUrl,
      fullText: fullText || 'Geen volledige tekst beschikbaar',
    };
  } catch (error: any) {
    console.error(`Error fetching content for ${ecli}:`, error.message);
    throw new Error(`Fout bij ophalen inhoud voor ${ecli}: ${error.message}`);
  }
}

// Helper function to extract text from XML nodes recursively
function extractTextFromNode(node: any): string {
  if (!node) return '';
  
  if (typeof node === 'string') {
    return node;
  }
  
  if (node['#text']) {
    return node['#text'];
  }
  
  let text = '';
  
  // Recursively extract text from all child nodes
  for (const key in node) {
    if (key.startsWith('@_')) continue; // Skip attributes
    
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach(item => {
        text += extractTextFromNode(item) + '\n';
      });
    } else if (typeof value === 'object') {
      text += extractTextFromNode(value) + '\n';
    } else if (typeof value === 'string') {
      text += value + ' ';
    }
  }
  
  return text.trim();
}

// Helper function to get full court name from code
function getCourtName(code: string): string {
  const courtNames: Record<string, string> = {
    'HR': 'Hoge Raad',
    'RBDHA': 'Rechtbank Den Haag',
    'RBAMS': 'Rechtbank Amsterdam',
    'RBROT': 'Rechtbank Rotterdam',
    'RBGEL': 'Rechtbank Gelderland',
    'RBMNE': 'Rechtbank Midden-Nederland',
    'RBNHO': 'Rechtbank Noord-Holland',
    'RBNNE': 'Rechtbank Noord-Nederland',
    'RBOBR': 'Rechtbank Oost-Brabant',
    'RBOVE': 'Rechtbank Overijssel',
    'RBZWB': 'Rechtbank Zeeland-West-Brabant',
    'RBLI M': 'Rechtbank Limburg',
    'GHARL': 'Gerechtshof Arnhem-Leeuwarden',
    'GHAMS': 'Gerechtshof Amsterdam',
    'GHSGR': "Gerechtshof 's-Gravenhage",
    'GHSHE': "Gerechtshof 's-Hertogenbosch",
    'CRVB': 'Centrale Raad van Beroep',
    'CBB': 'College van Beroep voor het bedrijfsleven',
    'RBSGR': "Rechtbank 's-Gravenhage", // Legacy
  };
  
  return courtNames[code] || code;
}
