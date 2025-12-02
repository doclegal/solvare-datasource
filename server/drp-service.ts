/**
 * DRP Service - Fetches Dutch local regulations (Decentrale Regelgeving) from overheid.nl
 * 
 * Uses the SRU (Search/Retrieve via URL) protocol to query the CVDR database.
 * CVDR = Centrale Voorziening Decentrale Regelgeving
 * 
 * Endpoints:
 * - Search: https://zoekservice.overheid.nl/sru/Search?x-connection=cvdr
 * - Repository: https://repository.officiele-overheidspublicaties.nl
 */

import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';
import type { LocalRegulation, LocalRegulationChunk } from '@shared/schema';

const SRU_BASE_URL = 'https://zoekservice.overheid.nl/sru/Search';
const CVDR_CONNECTION = 'cvdr';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '_text',
  parseAttributeValue: true,
  trimValues: true,
});

interface DrpSearchResult {
  regulations: LocalRegulation[];
  totalRecords: number;
  nextRecordPosition: number | null;
}

// Dutch provinces list for filtering
const DUTCH_PROVINCES = [
  'Drenthe', 'Flevoland', 'Friesland', 'Gelderland', 'Groningen',
  'Limburg', 'Noord-Brabant', 'Noord-Holland', 'Overijssel',
  'Utrecht', 'Zeeland', 'Zuid-Holland'
];

/**
 * Search for local regulations (omgevingsverordeningen) using SRU protocol
 * @param query - Search query (optional)
 * @param jurisdictionType - 'provincie' or 'gemeente' (optional)
 * @param jurisdiction - Specific province or municipality name (optional)
 * @param currentOnly - Only return current/in-force versions
 * @param startRecord - Starting position for pagination (1-based)
 * @param maxRecords - Maximum records per page
 */
export async function searchLocalRegulations(
  query: string = '*',
  jurisdictionType?: 'provincie' | 'gemeente',
  jurisdiction?: string,
  currentOnly: boolean = true,
  startRecord: number = 1,
  maxRecords: number = 50
): Promise<DrpSearchResult> {
  try {
    // Build CQL query for CVDR
    let cqlParts: string[] = [];

    // Add text search if provided
    if (query && query !== '*') {
      if (query.match(/^CVDR\d+/i)) {
        cqlParts.push(`dc.identifier=${query.toUpperCase()}`);
      } else {
        cqlParts.push(`dc.title any "${query}"`);
      }
    }

    // Filter by jurisdiction type (overheidnl.publicatieNaam contains jurisdiction info)
    if (jurisdictionType === 'provincie') {
      cqlParts.push(`overheid.publicatietype=provincie`);
    } else if (jurisdictionType === 'gemeente') {
      cqlParts.push(`overheid.publicatietype=gemeente`);
    }

    // Filter by specific jurisdiction (province or municipality name)
    if (jurisdiction) {
      cqlParts.push(`overheid.organisatie="${jurisdiction}"`);
    }

    // Filter for current versions only
    if (currentOnly) {
      const today = new Date().toISOString().split('T')[0];
      cqlParts.push(`dcterms.valid>=${today}`);
    }

    // Build final query
    let effectiveQuery: string;
    if (cqlParts.length === 0) {
      effectiveQuery = 'dcterms.modified>=1900-01-01';
    } else {
      effectiveQuery = cqlParts.join(' and ');
    }

    const params = new URLSearchParams({
      'x-connection': CVDR_CONNECTION,
      'operation': 'searchRetrieve',
      'version': '2.0',
      'query': effectiveQuery,
      'startRecord': startRecord.toString(),
      'maximumRecords': maxRecords.toString(),
    });

    const url = `${SRU_BASE_URL}?${params.toString()}`;
    console.log(`[DRP Service] Searching: ${url}`);

    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'Accept': 'application/xml',
      },
    });

    const parsed = xmlParser.parse(response.data);
    
    const searchResponse = parsed['sru:searchRetrieveResponse'] || parsed['searchRetrieveResponse'] || parsed;
    const numberOfRecords = searchResponse['sru:numberOfRecords'] || searchResponse['numberOfRecords'] || 0;
    const records = searchResponse['sru:records']?.['sru:record'] || 
                    searchResponse['records']?.['record'] || 
                    [];
    
    const regulations: LocalRegulation[] = [];
    const recordsArray = Array.isArray(records) ? records : (records ? [records] : []);

    for (const record of recordsArray) {
      try {
        const regulation = parseRecordToLocalRegulation(record);
        if (regulation) {
          regulations.push(regulation);
        }
      } catch (error) {
        console.error('[DRP Service] Error parsing record:', error);
      }
    }

    const nextRecordPosition = startRecord + regulations.length;
    const hasMore = nextRecordPosition <= numberOfRecords;

    console.log(`[DRP Service] Found ${regulations.length} regulations (total: ${numberOfRecords})`);

    return {
      regulations,
      totalRecords: numberOfRecords,
      nextRecordPosition: hasMore ? nextRecordPosition : null,
    };
  } catch (error: any) {
    console.error('[DRP Service] Search error:', error.message);
    throw new Error(`DRP zoekfout: ${error.message}`);
  }
}

/**
 * Parse an SRU record to LocalRegulation format
 */
function parseRecordToLocalRegulation(record: any): LocalRegulation | null {
  try {
    const recordData = record['sru:recordData'] || record['recordData'] || record;
    const gzd = recordData['gzd:gzd'] || recordData['gzd'] || recordData;
    const originalData = gzd['gzd:originalData'] || gzd['originalData'] || {};
    const enrichedData = gzd['gzd:enrichedData'] || gzd['enrichedData'] || {};
    
    // Get metadata from different possible paths
    const meta = originalData['overheidcvdr:meta'] || originalData['meta'] || {};
    const owmsMeta = meta['overheidcvdr:owmskern'] || meta['owmskern'] || {};
    const owmsMantel = meta['overheidcvdr:owmsmantel'] || meta['owmsmantel'] || {};

    // Extract CVDR identifier
    let regulationId = extractTextValue(owmsMeta['dcterms:identifier'] || owmsMeta['identifier']);
    if (!regulationId) {
      regulationId = extractTextValue(enrichedData['dcterms:identifier'] || enrichedData['identifier']);
    }
    
    // Extract title
    let title = extractTextValue(owmsMeta['dcterms:title'] || owmsMeta['title']);
    if (!title) {
      title = extractTextValue(enrichedData['dcterms:title'] || enrichedData['title']);
    }
    
    // Extract creator/organisation (jurisdiction)
    let jurisdiction = extractTextValue(owmsMeta['dcterms:creator'] || owmsMeta['creator']);
    if (!jurisdiction) {
      jurisdiction = extractTextValue(owmsMantel['dcterms:creator'] || owmsMantel['creator']);
    }
    if (!jurisdiction) {
      jurisdiction = extractTextValue(enrichedData['dcterms:creator'] || enrichedData['creator']);
    }

    // Determine jurisdiction type based on province list
    const jurisdictionType: 'provincie' | 'gemeente' = 
      DUTCH_PROVINCES.some(p => jurisdiction?.toLowerCase().includes(p.toLowerCase())) 
        ? 'provincie' 
        : 'gemeente';

    // Extract regulation type
    let regulationType = extractTextValue(owmsMeta['dcterms:type'] || owmsMeta['type']);
    if (!regulationType) {
      regulationType = extractTextValue(enrichedData['dcterms:type'] || enrichedData['type']);
    }

    // Extract dates
    const publicationDate = extractTextValue(owmsMantel['dcterms:issued'] || owmsMantel['issued']);
    
    // Valid date can be a range or single date
    const validValue = owmsMantel['dcterms:valid'] || owmsMantel['valid'];
    let validFrom: string | undefined;
    let validTo: string | undefined;
    
    if (validValue) {
      const validText = extractTextValue(validValue);
      if (validText) {
        // Parse date range if present (e.g., "2020-01-01/2025-12-31")
        if (validText.includes('/')) {
          const [from, to] = validText.split('/');
          validFrom = from;
          validTo = to;
        } else {
          validFrom = validText;
        }
      }
    }

    // Determine if current version
    const today = new Date().toISOString().split('T')[0];
    const isCurrentVersion = !validTo || validTo >= today;

    if (!regulationId || !title) {
      return null;
    }

    return {
      regulationId,
      title,
      jurisdiction: jurisdiction || 'Onbekend',
      jurisdictionType,
      regulationType: regulationType || undefined,
      publicationDate: publicationDate || undefined,
      validFrom: validFrom || undefined,
      validTo: validTo || undefined,
      isCurrentVersion,
      isSelected: false,
    };
  } catch (error) {
    console.error('[DRP Service] Parse error:', error);
    return null;
  }
}

/**
 * Helper to extract text value from various XML node formats
 */
function extractTextValue(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value._text) return value._text;
  if (value['#text']) return value['#text'];
  return undefined;
}

/**
 * Download and parse local regulation XML from repository
 */
export async function downloadLocalRegulationXml(
  regulationId: string,
  xmlUrl?: string
): Promise<{ content: string; hash: string }> {
  try {
    // Construct repository URL if not provided
    // CVDR IDs format: CVDR123456_1 (with version suffix)
    const baseId = regulationId.split('_')[0];
    const repositoryUrl = xmlUrl || 
      `https://repository.officiele-overheidspublicaties.nl/cvdr/${baseId}/${regulationId}.xml`;
    
    console.log(`[DRP Service] Downloading: ${repositoryUrl}`);

    const response = await axios.get(repositoryUrl, {
      timeout: 60000,
      headers: {
        'Accept': 'application/xml, text/xml',
      },
      maxContentLength: 50 * 1024 * 1024, // 50MB max
    });

    const content = response.data;
    
    // Verify we got XML
    if (typeof content === 'string' && content.trim().startsWith('<!DOCTYPE HTML')) {
      throw new Error('Ontvangen HTML in plaats van XML');
    }
    
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    console.log(`[DRP Service] Downloaded ${regulationId}: ${content.length} bytes, hash: ${hash.substring(0, 16)}...`);

    return { content, hash };
  } catch (error: any) {
    console.error(`[DRP Service] Download error for ${regulationId}:`, error.message);
    throw new Error(`Fout bij downloaden ${regulationId}: ${error.message}`);
  }
}

/**
 * Parse local regulation XML into chunks for Pinecone
 */
export function parseLocalRegulationToChunks(
  xmlContent: string,
  regulationId: string,
  title: string,
  jurisdiction: string,
  jurisdictionType: 'provincie' | 'gemeente',
  regulationType: string = 'verordening',
  versionDate?: string,
  isCurrentVersion: boolean = true
): LocalRegulationChunk[] {
  const chunks: LocalRegulationChunk[] = [];

  try {
    const parsed = xmlParser.parse(xmlContent);
    
    // CVDR XML structure varies, try different paths
    const regeling = parsed['regeling'] || parsed['cvdr:regeling'] || 
                     parsed['regelgeving'] || parsed;
    const regelingTekst = regeling['regeling-tekst'] || regeling['regelgevingtekst'] || 
                          regeling['tekst'] || regeling;

    // Find all articles
    const articles = findAllArticlesInLocalRegulation(regelingTekst);
    
    let chunkIndex = 0;
    
    for (const article of articles) {
      const articleNumber = article.number || `${chunkIndex + 1}`;
      const articleTitle = article.title || '';
      const articleContent = article.content || '';
      const structurePath = article.structurePath || '';
      
      // Skip empty articles
      if (!articleContent.trim()) continue;
      
      // Check if article is small enough for one chunk (< 500 words)
      const wordCount = articleContent.split(/\s+/).length;
      
      if (wordCount <= 500) {
        chunks.push({
          id: `${regulationId}#art${articleNumber}#0#${versionDate || 'current'}`,
          text: formatLocalChunkText(articleNumber, articleTitle, articleContent, jurisdiction, structurePath),
          regulation_id: regulationId,
          regulation_title: title,
          jurisdiction,
          type: regulationType,
          source: 'decentrale_regelgeving',
          article_number: articleNumber,
          seq_in_article: 0,
          structure_path: structurePath,
          version_date: versionDate,
          is_current_version: isCurrentVersion,
          jurisdictionType,
          chunkIndex,
        });
        chunkIndex++;
      } else {
        // Split by paragraphs - handle both structured paragraphs and plain strings
        const rawParagraphs = article.paragraphs || splitIntoParagraphs(articleContent);
        
        for (let i = 0; i < rawParagraphs.length; i++) {
          const para = rawParagraphs[i];
          const paraContent = typeof para === 'string' ? para : para.content;
          const paraNumber = typeof para === 'string' ? `${i + 1}` : (para.number || `${i + 1}`);
          
          chunks.push({
            id: `${regulationId}#art${articleNumber}#${i}#${versionDate || 'current'}`,
            text: formatLocalChunkText(articleNumber, articleTitle, paraContent, jurisdiction, structurePath),
            regulation_id: regulationId,
            regulation_title: title,
            jurisdiction,
            type: regulationType,
            source: 'decentrale_regelgeving',
            article_number: articleNumber,
            paragraph_number: paraNumber,
            seq_in_article: i,
            structure_path: structurePath,
            version_date: versionDate,
            is_current_version: isCurrentVersion,
            jurisdictionType,
            chunkIndex,
          });
          chunkIndex++;
        }
      }
    }

    // Set total chunks on each chunk
    chunks.forEach(chunk => {
      chunk.totalChunks = chunks.length;
    });

    console.log(`[DRP Service] Parsed ${chunks.length} chunks from ${regulationId}`);
    return chunks;
  } catch (error: any) {
    console.error(`[DRP Service] Parse error for ${regulationId}:`, error.message);
    throw new Error(`Fout bij parsen ${regulationId}: ${error.message}`);
  }
}

interface ArticleData {
  number: string;
  title?: string;
  content: string;
  structurePath: string;
  paragraphs?: { number: string; content: string }[];
}

/**
 * Find all articles in local regulation with their hierarchical structure
 */
function findAllArticlesInLocalRegulation(node: any, path: string[] = []): ArticleData[] {
  const articles: ArticleData[] = [];

  if (!node || typeof node !== 'object') {
    return articles;
  }

  // Process arrays
  if (Array.isArray(node)) {
    for (const item of node) {
      articles.push(...findAllArticlesInLocalRegulation(item, path));
    }
    return articles;
  }

  // Check for structure elements (hoofdstuk, afdeling, paragraaf)
  let newPath = [...path];
  
  // Hoofdstuk (Chapter)
  if (node['hoofdstuk'] || node['@_nr'] && (node['kop'] || node['titel'])) {
    const nr = node['@_nr'] || '';
    const titel = extractNestedText(node['kop'] || node['titel']);
    if (nr || titel) {
      newPath.push(`hoofdstuk:${nr}${titel ? `:${titel}` : ''}`);
    }
  }
  
  // Afdeling (Section)
  if (node['afdeling']) {
    const afd = node['afdeling'];
    const nr = typeof afd === 'object' ? (afd['@_nr'] || '') : '';
    const titel = typeof afd === 'object' ? extractNestedText(afd['kop'] || afd['titel']) : '';
    if (nr || titel) {
      newPath.push(`afdeling:${nr}${titel ? `:${titel}` : ''}`);
    }
  }

  // Paragraaf (Subsection)
  if (node['paragraaf']) {
    const para = node['paragraaf'];
    const nr = typeof para === 'object' ? (para['@_nr'] || '') : '';
    const titel = typeof para === 'object' ? extractNestedText(para['kop'] || para['titel']) : '';
    if (nr || titel) {
      newPath.push(`paragraaf:${nr}${titel ? `:${titel}` : ''}`);
    }
  }

  // Check if this is an artikel (article)
  if (node['artikel'] !== undefined) {
    const artikelen = Array.isArray(node['artikel']) ? node['artikel'] : [node['artikel']];
    
    for (const artikel of artikelen) {
      if (!artikel) continue;
      
      const nr = artikel['@_nr'] || artikel['@_nummer'] || '';
      const kop = extractNestedText(artikel['kop'] || artikel['titel']);
      const content = extractArticleContent(artikel);
      const paragraphs = extractParagraphs(artikel);
      
      if (content || paragraphs.length > 0) {
        articles.push({
          number: nr,
          title: kop || undefined,
          content: content || paragraphs.map(p => p.content).join('\n\n'),
          structurePath: newPath.join('|'),
          paragraphs: paragraphs.length > 0 ? paragraphs : undefined,
        });
      }
    }
  }

  // Recursively process child elements
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '_text' || key === '#text') continue;
    
    const child = node[key];
    if (child && typeof child === 'object') {
      articles.push(...findAllArticlesInLocalRegulation(child, newPath));
    }
  }

  return articles;
}

/**
 * Extract paragraphs (leden) from an article
 */
function extractParagraphs(artikel: any): { number: string; content: string }[] {
  const paragraphs: { number: string; content: string }[] = [];
  
  const leden = artikel['lid'] || artikel['leden']?.['lid'];
  if (!leden) return paragraphs;
  
  const ledenArray = Array.isArray(leden) ? leden : [leden];
  
  for (const lid of ledenArray) {
    if (!lid) continue;
    
    const nr = lid['@_nr'] || lid['lidnr'] || '';
    const content = extractNestedText(lid);
    
    if (content) {
      paragraphs.push({
        number: nr.toString(),
        content,
      });
    }
  }
  
  return paragraphs;
}

/**
 * Extract article content, excluding structure elements
 */
function extractArticleContent(artikel: any): string {
  const parts: string[] = [];
  
  // Get intro/content directly in artikel
  if (artikel['al'] || artikel['tekst'] || artikel['inhoud']) {
    const content = extractNestedText(artikel['al'] || artikel['tekst'] || artikel['inhoud']);
    if (content) parts.push(content);
  }
  
  // Check for direct text content
  if (artikel._text) {
    parts.push(artikel._text);
  }
  
  return parts.join('\n\n');
}

/**
 * Extract all text from a nested XML node
 */
function extractNestedText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return node.toString();
  
  const parts: string[] = [];
  
  if (node._text) {
    parts.push(node._text);
  }
  if (node['#text']) {
    parts.push(node['#text']);
  }
  
  if (Array.isArray(node)) {
    for (const item of node) {
      parts.push(extractNestedText(item));
    }
  } else if (typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (!key.startsWith('@_')) {
        parts.push(extractNestedText(node[key]));
      }
    }
  }
  
  return parts.filter(p => p.trim()).join(' ').trim();
}

/**
 * Split content into paragraphs
 */
function splitIntoParagraphs(content: string): string[] {
  return content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
}

/**
 * Format chunk text with context
 */
function formatLocalChunkText(
  articleNumber: string,
  articleTitle: string,
  content: string,
  jurisdiction: string,
  structurePath: string
): string {
  const parts: string[] = [];
  
  // Add jurisdiction context
  parts.push(`[${jurisdiction}]`);
  
  // Add structure path if present
  if (structurePath) {
    const pathParts = structurePath.split('|').map(p => {
      const [type, ...rest] = p.split(':');
      return rest.join(':') || type;
    });
    if (pathParts.length > 0) {
      parts.push(pathParts.join(' > '));
    }
  }
  
  // Add article header
  const header = articleTitle 
    ? `Artikel ${articleNumber}: ${articleTitle}`
    : `Artikel ${articleNumber}`;
  parts.push(header);
  
  // Add content
  parts.push(content);
  
  return parts.join('\n\n');
}

/**
 * Get list of Dutch provinces for filtering
 */
export function getDutchProvinces(): string[] {
  return [...DUTCH_PROVINCES];
}
