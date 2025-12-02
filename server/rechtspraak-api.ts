import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import type { EcliRecord, PreparedRecord, SearchFilters } from '@shared/schema';
import civilSubcategories from './data/civil-subcategories.json';
import instanties from './data/instanties.json';

const RECHTSPRAAK_BASE_URL = 'https://data.rechtspraak.nl/uitspraken';
// IMPORTANT: parseAttributeValue AND parseTagValue must be false to preserve numeric strings
// parseAttributeValue: false - prevents attribute values like status="2.20" from becoming 2.2
// parseTagValue: false - prevents text content like <nr>2.20</nr> from becoming 2.2
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
});

interface RechtspraakSearchResponse {
  feed: {
    entry: any | any[];
    'opensearch:totalResults'?: number;
    subtitle?: string | { '#text': string };
  };
}

/**
 * Convert year/month to date range for filtering
 * Returns both dateFrom and dateTo to create a bounded range
 * Uses manual YYYY-MM-DD formatting to avoid timezone issues
 */
function convertYearMonthToDates(year?: number, month?: number): { dateFrom?: string; dateTo?: string } {
  if (!year) {
    return {}; // No year specified, no filter
  }
  
  // Helper to format manual date components as YYYY-MM-DD
  const formatManualDate = (y: number, m: number, d: number): string => {
    const yearStr = y.toString().padStart(4, '0');
    const monthStr = m.toString().padStart(2, '0');
    const dayStr = d.toString().padStart(2, '0');
    return `${yearStr}-${monthStr}-${dayStr}`;
  };
  
  if (month) {
    // Specific month: e.g., January 2024 = 2024-01-01 to 2024-02-01
    const fromDate = formatManualDate(year, month, 1);
    
    // Calculate next month (handle year rollover)
    const toMonth = month === 12 ? 1 : month + 1;
    const toYear = month === 12 ? year + 1 : year;
    const toDate = formatManualDate(toYear, toMonth, 1);
    
    return { dateFrom: fromDate, dateTo: toDate };
  } else {
    // Whole year: e.g., 2024 = 2024-01-01 to 2025-01-01
    const fromDate = formatManualDate(year, 1, 1);
    const toDate = formatManualDate(year + 1, 1, 1);
    
    return { dateFrom: fromDate, dateTo: toDate };
  }
}

/**
 * Helper to format date as YYYY-MM-DD without timezone conversion
 */
function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0'); // +1 because months are 0-indexed
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Convert a date period string to a start date for filtering
 * Uses the 'modified' field to filter on when the judgment was last updated in the database
 * Note: The Rechtspraak API does not support filtering on actual judgment date (uitspraakdatum),
 * only on publication/modification dates.
 * Uses timezone-safe formatting to avoid off-by-one-day errors
 */
function convertPeriodToDates(period: string): { dateFrom?: string } {
  if (period === 'all' || !period) {
    return {}; // No date filter - return all results
  }
  
  const now = new Date();
  const fromDate = new Date(now);
  
  switch (period) {
    case '1week':
      fromDate.setDate(now.getDate() - 7);
      break;
    case '1month':
      fromDate.setMonth(now.getMonth() - 1);
      break;
    case '1year':
      fromDate.setFullYear(now.getFullYear() - 1);
      break;
    case '5years':
      fromDate.setFullYear(now.getFullYear() - 5);
      break;
    case '10years':
      fromDate.setFullYear(now.getFullYear() - 10);
      break;
    default:
      return {}; // Unknown period, no filter
  }
  
  return {
    dateFrom: formatDateYYYYMMDD(fromDate),
  };
}

export async function searchDecisions(filters: SearchFilters): Promise<{
  records: EcliRecord[];
  totalResults: number;
}> {
  const params = new URLSearchParams();
  
  // NEW: Year/Month filtering takes precedence over period filtering
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  
  if (filters.year) {
    // Use specific year/month filtering (Methode 1)
    const yearMonthDates = convertYearMonthToDates(filters.year, filters.month);
    dateFrom = yearMonthDates.dateFrom;
    dateTo = yearMonthDates.dateTo;
    console.log(`[Rechtspraak API] Year/Month filtering: ${filters.year}${filters.month ? '/' + filters.month : ''} → ${dateFrom} to ${dateTo}`);
  } else {
    // Fall back to relative period filtering (Methode 2)
    const periodDates = convertPeriodToDates(filters.datePeriod || 'all');
    dateFrom = periodDates.dateFrom;
  }
  
  // Filter on Civielrecht or specific subcategory
  const subcategoryId = filters.civilSubcategory || 'all';
  const subcategory = civilSubcategories.find(cat => cat.id === subcategoryId);
  const subjectUri = subcategory?.value || 'http://psi.rechtspraak.nl/rechtsgebied#civielRecht';
  params.append('subject', subjectUri);
  
  // Always filter on Uitspraak (not Conclusie)
  params.append('type', 'Uitspraak');
  
  if (filters.court && filters.court !== 'all') {
    // Map court abbreviation to full URI
    // The API requires the full URI, not the abbreviation
    const court = instanties.find((inst: any) => inst.afkorting === filters.court);
    const courtValue = court?.identifier || filters.court;
    params.append('creator', courtValue);
  }
  
  // Add date filter for year/month searches, or modified filter for relative period searches
  // KEY DIFFERENCE:
  // - 'date' parameter = JUDGMENT DATE (when court issued ruling) - used for HISTORICAL SEARCH
  // - 'modified' parameter = PUBLICATION DATE (when record added to database) - used for INCREMENTAL UPDATES
  // 
  // For year/month filtering (e.g., "January 2010"), we use 'date' to find rulings issued in that period
  // For relative periods (e.g., "last 10 years"), we use 'modified' for efficient incremental harvesting
  
  if (filters.year) {
    // Year/Month filtering → Use 'date' parameter for judgment date
    // This finds rulings that were DECIDED in the specified month/year
    if (dateFrom) {
      params.append('date', dateFrom);
    }
    if (dateTo) {
      // For month filtering: exclusive upper bound (e.g., 2010-02-01 to exclude February)
      // Adjust to inclusive bound by subtracting one day
      const inclusiveDateTo = new Date(dateTo);
      inclusiveDateTo.setDate(inclusiveDateTo.getDate() - 1);
      params.append('date', inclusiveDateTo.toISOString().split('T')[0]);
    }
  } else {
    // Relative period filtering → Use 'modified' parameter for publication date
    // This finds rulings that were PUBLISHED/UPDATED in the specified period
    if (dateFrom) {
      params.append('modified', dateFrom);
    }
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
    
    if (!data.feed) {
      return { records: [], totalResults: 0 };
    }

    // Extract total results count
    // When return=DOC is used, opensearch:totalResults is not provided
    // Instead, the count is in subtitle as "Aantal gevonden ECLI's: 1493"
    let totalResults = data.feed['opensearch:totalResults'] || 0;
    
    if (totalResults === 0 && data.feed.subtitle) {
      const subtitle = typeof data.feed.subtitle === 'string' 
        ? data.feed.subtitle 
        : data.feed.subtitle['#text'] || '';
      
      const match = subtitle.match(/Aantal gevonden ECLI's:\s*(\d+)/);
      if (match && match[1]) {
        totalResults = parseInt(match[1], 10);
      }
    }
    
    console.log('[Rechtspraak API] Response status:', response.status);
    console.log('[Rechtspraak API] Total results:', totalResults);
    console.log('[Rechtspraak API] Entries count:', Array.isArray(data.feed?.entry) ? data.feed.entry.length : (data.feed?.entry ? 1 : 0));
    
    // Handle both single entry and multiple entries
    let entries = data.feed.entry;
    if (!entries) {
      return { records: [], totalResults: 0 };
    }
    
    if (!Array.isArray(entries)) {
      entries = [entries];
    }

    const records: EcliRecord[] = entries
      .map((entry: any) => {
        const ecli = entry.id || '';
        const title = entry.title?.['#text'] || entry.title || 'Geen titel';
        
        // Extract summary (Inhoudsindicatie)
        let summary = '';
        if (entry.summary) {
          if (typeof entry.summary === 'string') {
            summary = entry.summary.trim();
          } else if (entry.summary['#text']) {
            summary = entry.summary['#text'].trim();
          }
        }
        
        // Extract court from ECLI (e.g., ECLI:NL:HR:2024:123 -> HR = Hoge Raad)
        const ecliParts = ecli.split(':');
        let court = 'Onbekend';
        if (ecliParts.length >= 3) {
          const courtCode = ecliParts[2];
          court = getCourtName(courtCode);
        }
        
        // Extract decision date (when the case was decided, from ECLI or updated field)
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
          summary,
        };
      })
      // CRITICAL FILTER: Only keep records with valid Inhoudsindicatie
      // Filter out:
      // - Empty summaries
      // - Single dash "-" (indicates missing summary)
      // - Whitespace-only summaries
      .filter((record: any) => {
        const hasValidSummary = record.summary && 
                               record.summary.trim() !== '' && 
                               record.summary.trim() !== '-';
        
        if (!hasValidSummary) {
          console.log(`[Rechtspraak API] Filtered out ${record.ecli} - no valid Inhoudsindicatie`);
        }
        
        return hasValidSummary;
      });
    
    const filteredCount = entries.length - records.length;
    if (filteredCount > 0) {
      console.log(`[Rechtspraak API] Filtered out ${filteredCount} records without valid Inhoudsindicatie`);
    }

    return { records, totalResults };
  } catch (error: any) {
    console.error('Error searching Rechtspraak API:', error.message);
    throw new Error(`Fout bij ophalen uitspraken: ${error.message}`);
  }
}

/**
 * Normalize URI for comparison (lowercase, remove trailing slash, fragment, query)
 */
function normalizeUri(uri: string): string {
  return uri
    .toLowerCase()
    .replace(/[#?].*$/, '') // Remove fragment and query
    .replace(/\/$/, '');     // Remove trailing slash
}

/**
 * Normalize label for comparison (lowercase, split on semicolons, trim)
 */
function normalizeLabel(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[;,]/)  // Split on semicolon or comma
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Known civil law URI's from civil-subcategories.json
 */
const CIVIL_LAW_URIS = new Set(
  civilSubcategories.map(cat => normalizeUri(cat.value))
);

/**
 * Known civil law labels (keywords that indicate civil law)
 * More specific than just "civiel" to avoid false positives
 */
const CIVIL_LAW_LABELS = new Set([
  'civiel recht',
  'civielrecht',
  'arbeidsrecht',
  'huurrecht',
  'goederenrecht',
  'verbintenissenrecht',
  'personen- en familierecht',
  'insolventierecht',
  'ondernemingsrecht',
  'intellectueel eigendomsrecht',
  'intellectueel eigendom',
  'europees civiel recht',
]);

/**
 * Check if legal area contains civil law
 * Returns { isCivil, subjects } where:
 * - isCivil: true if at least one civil subject is found
 * - subjects: extracted subject URIs and labels
 */
function checkCivilLegalArea(subjectData: any): { isCivil: boolean; subjects: Array<{ uri?: string; label?: string }> } {
  const subjects: Array<{ uri?: string; label?: string }> = [];
  
  if (!subjectData) {
    return { isCivil: false, subjects: [] };
  }
  
  const subjectArray = Array.isArray(subjectData) ? subjectData : [subjectData];
  
  for (const subject of subjectArray) {
    const uri = subject['@_resourceIdentifier'] || subject['@_rdf:resource'];
    const label = subject['#text'] || subject;
    
    const subjectInfo: { uri?: string; label?: string } = {};
    
    if (uri && typeof uri === 'string') {
      subjectInfo.uri = uri;
    }
    
    if (label && typeof label === 'string' && label.trim() && label !== 'Rechtsgebied') {
      subjectInfo.label = label.trim();
    }
    
    if (subjectInfo.uri || subjectInfo.label) {
      subjects.push(subjectInfo);
    }
  }
  
  // Check if any subject is civil law
  let hasCivilSubject = false;
  
  // Known non-civil keywords that should block acceptance
  const nonCivilKeywords = [
    'strafrecht',
    'bestuursrecht',
    'belastingrecht',
    'omgevingsrecht',
    'vreemdelingenrecht',
  ];
  
  for (const subject of subjects) {
    // Check URI first (most reliable)
    if (subject.uri) {
      const normalizedUri = normalizeUri(subject.uri);
      
      // Check if it's a known civil law URI
      if (CIVIL_LAW_URIS.has(normalizedUri)) {
        hasCivilSubject = true;
        break; // Found civil URI, we're done
      }
      
      // Check if it's explicitly non-civil URI
      const uriLower = normalizedUri.toLowerCase();
      for (const keyword of nonCivilKeywords) {
        if (uriLower.includes(keyword)) {
          // Non-civil URI found, skip this case entirely
          return { isCivil: false, subjects };
        }
      }
    }
    
    // Fallback: check labels if no URI match yet
    if (!hasCivilSubject && subject.label) {
      const normalizedLabels = normalizeLabel(subject.label);
      
      // Check each label part for civil law indicators
      for (const labelPart of normalizedLabels) {
        // First check for non-civil keywords - these are blocking
        for (const keyword of nonCivilKeywords) {
          if (labelPart.includes(keyword)) {
            // Non-civil label found, skip this case entirely
            return { isCivil: false, subjects };
          }
        }
        
        // Then check for civil law labels
        const civilLabelsArray = Array.from(CIVIL_LAW_LABELS);
        for (const civilLabel of civilLabelsArray) {
          if (labelPart === civilLabel || labelPart.includes(civilLabel)) {
            hasCivilSubject = true;
            break;
          }
        }
        
        if (hasCivilSubject) break;
      }
    }
  }
  
  return { isCivil: hasCivilSubject, subjects };
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
    
    // Extract and validate legal area
    const legalAreaCheck = checkCivilLegalArea(mainDesc['dcterms:subject']);
    
    // Build legalArea array from extracted subjects
    const legalArea: string[] = legalAreaCheck.subjects
      .filter(s => s.label)
      .map(s => s.label as string);
    
    console.log(`[${ecli}] Legal area subjects:`, legalAreaCheck.subjects);
    console.log(`[${ecli}] Is civil:`, legalAreaCheck.isCivil);
    
    // Validate that this is actually a civil law case
    if (!legalAreaCheck.isCivil) {
      const subjectLabels = legalAreaCheck.subjects.map(s => s.label || s.uri || 'Unknown').join(', ');
      throw new Error(`Niet-civiele zaak: ${subjectLabels || 'Geen rechtsgebied gevonden'}`);
    }
    
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
    
    // Extract Inhoudsindicatie (official summary) 
    // The inhoudsindicatie is in a separate section in the XML: data['open-rechtspraak'].inhoudsindicatie
    let inhoudsindicatie = '';
    
    // Priority 1: Check the dedicated inhoudsindicatie section
    if (data['open-rechtspraak']?.inhoudsindicatie) {
      const inhoudNode = data['open-rechtspraak'].inhoudsindicatie;
      // Extract text from the inhoudsindicatie node (often contains 'para' or direct text)
      inhoudsindicatie = extractTextFromNode(inhoudNode);
    }
    
    // Priority 2: Try dcterms:abstract if it has actual text (not just a reference)
    if (!inhoudsindicatie && mainDesc['dcterms:abstract']) {
      const abstractNode = mainDesc['dcterms:abstract'];
      // Only use if it's actual text, not a reference
      if (abstractNode['#text'] || (typeof abstractNode === 'string' && !abstractNode.includes('resourceIdentifier'))) {
        inhoudsindicatie = abstractNode['#text'] || abstractNode;
      }
    }
    
    // Priority 3: Try psi:inhoudsindicatie as fallback
    if (!inhoudsindicatie && mainDesc['psi:inhoudsindicatie']) {
      const inhoudNode = mainDesc['psi:inhoudsindicatie'];
      inhoudsindicatie = extractTextFromNode(inhoudNode);
    }
    
    if (typeof inhoudsindicatie === 'string') {
      inhoudsindicatie = inhoudsindicatie.trim();
    }
    
    console.log(`[${ecli}] Inhoudsindicatie found:`, inhoudsindicatie ? `${inhoudsindicatie.substring(0, 100)}...` : 'NONE');
    
    // IMPORTANT: We no longer fetch full text - only metadata
    // This is much faster and more efficient
    
    const sourceUrl = `https://uitspraken.rechtspraak.nl/details?id=${ecli}`;
    
    return {
      ecli,
      title,
      court,
      decisionDate,
      legalArea: legalArea.length > 0 ? legalArea : ['Niet gespecificeerd'],
      procedureType,
      sourceUrl,
      inhoudsindicatie: inhoudsindicatie || 'Geen inhoudsindicatie beschikbaar',
      source: 'api_search', // Default source for API fetched records
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

/**
 * Extract full judgment text from Rechtspraak XML
 */
export async function fetchFullText(ecli: string): Promise<string> {
  const url = `${RECHTSPRAAK_BASE_URL}/content?id=${encodeURIComponent(ecli)}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/xml',
      },
      timeout: 30000,
    });

    const data = parser.parse(response.data);
    
    // Extract full text from uitspraak or conclusie sections
    const uitspraak = data['open-rechtspraak']?.uitspraak || data['open-rechtspraak']?.conclusie || {};
    
    // Extract text recursively from the entire uitspraak/conclusie node
    const fullText = extractTextFromNode(uitspraak);
    
    if (!fullText || fullText.length < 100) {
      throw new Error('Volledige tekst niet gevonden of te kort');
    }
    
    return fullText;
  } catch (error: any) {
    console.error(`Error fetching full text for ${ecli}:`, error.message);
    throw new Error(`Fout bij ophalen volledige tekst voor ${ecli}: ${error.message}`);
  }
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
