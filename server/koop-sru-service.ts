/**
 * KOOP SRU Service - Fetches Dutch legislation (BWB regulations) from overheid.nl
 * 
 * Uses the SRU (Search/Retrieve via URL) protocol to query the BWB database.
 * BWB = Basis Wetten Bestand (Base Laws Database)
 * 
 * Endpoints:
 * - Search: https://zoekservice.overheid.nl/sru/Search?x-connection=BWB
 * - Documentation: https://koop.overheid.nl/sites/koop/files/media/handleiding-sru-search-api.pdf
 */

import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';
import type { BwbRegulation, LawChunk } from '@shared/schema';

const SRU_BASE_URL = 'https://zoekservice.overheid.nl/sru/Search';
const BWB_CONNECTION = 'BWB';

// XML Parser configuration for SRU responses
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '_text',
  parseAttributeValue: true,
  trimValues: true,
});

interface SruSearchResult {
  regulations: BwbRegulation[];
  totalRecords: number;
  nextRecordPosition: number | null;
}

/**
 * Search for BWB regulations using SRU protocol
 * @param query - CQL query string (optional, defaults to all regulations)
 * @param startRecord - Starting position for pagination (1-based)
 * @param maxRecords - Maximum records per page (default 100)
 */
export async function searchBwbRegulations(
  query: string = '*',
  startRecord: number = 1,
  maxRecords: number = 100
): Promise<SruSearchResult> {
  try {
    // Build SRU request URL
    const params = new URLSearchParams({
      'x-connection': BWB_CONNECTION,
      'operation': 'searchRetrieve',
      'version': '2.0',
      'query': query,
      'startRecord': startRecord.toString(),
      'maximumRecords': maxRecords.toString(),
    });

    const url = `${SRU_BASE_URL}?${params.toString()}`;
    console.log(`[KOOP SRU] Searching: ${url}`);

    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'Accept': 'application/xml',
      },
    });

    const parsed = xmlParser.parse(response.data);
    
    // Navigate to search results
    const searchResponse = parsed['sru:searchRetrieveResponse'] || parsed['searchRetrieveResponse'] || parsed;
    const numberOfRecords = searchResponse['sru:numberOfRecords'] || searchResponse['numberOfRecords'] || 0;
    const records = searchResponse['sru:records']?.['sru:record'] || 
                    searchResponse['records']?.['record'] || 
                    [];
    
    // Parse each record
    const regulations: BwbRegulation[] = [];
    const recordsArray = Array.isArray(records) ? records : (records ? [records] : []);

    for (const record of recordsArray) {
      try {
        const regulation = parseRecordToBwbRegulation(record);
        if (regulation) {
          regulations.push(regulation);
        }
      } catch (error) {
        console.error('[KOOP SRU] Error parsing record:', error);
      }
    }

    // Calculate next record position
    const nextRecordPosition = startRecord + regulations.length;
    const hasMore = nextRecordPosition <= numberOfRecords;

    console.log(`[KOOP SRU] Found ${regulations.length} regulations (total: ${numberOfRecords})`);

    return {
      regulations,
      totalRecords: numberOfRecords,
      nextRecordPosition: hasMore ? nextRecordPosition : null,
    };
  } catch (error: any) {
    console.error('[KOOP SRU] Search error:', error.message);
    throw new Error(`SRU zoekfout: ${error.message}`);
  }
}

/**
 * Parse an SRU record to BwbRegulation format
 */
function parseRecordToBwbRegulation(record: any): BwbRegulation | null {
  try {
    // Get the record data - try different path structures
    const recordData = record['sru:recordData'] || record['recordData'] || record;
    const gzd = recordData['gzd:gzd'] || recordData['gzd'] || recordData;
    const originalData = gzd['gzd:originalData'] || gzd['originalData'] || {};
    const meta = originalData['overheidbwb:meta'] || originalData['meta'] || {};
    const enrichedData = gzd['gzd:enrichedData'] || gzd['enrichedData'] || {};

    // Extract BWB identifier
    let bwbId = '';
    const owmsMeta = meta['overheidbwb:owmskern'] || meta['owmskern'] || {};
    const identifier = owmsMeta['dcterms:identifier'] || owmsMeta['identifier'];
    
    if (typeof identifier === 'string') {
      bwbId = identifier;
    } else if (identifier?._text) {
      bwbId = identifier._text;
    } else if (identifier?.['#text']) {
      bwbId = identifier['#text'];
    }

    // Try alternative path for BWB ID
    if (!bwbId) {
      const altIdentifier = enrichedData['dcterms:identifier'] || enrichedData['identifier'];
      if (typeof altIdentifier === 'string') {
        bwbId = altIdentifier;
      } else if (altIdentifier?._text) {
        bwbId = altIdentifier._text;
      }
    }

    if (!bwbId) {
      console.warn('[KOOP SRU] Record without BWB ID, skipping');
      return null;
    }

    // Extract title
    let title = '';
    const titleField = owmsMeta['dcterms:title'] || owmsMeta['title'] || 
                       enrichedData['dcterms:title'] || enrichedData['title'];
    if (typeof titleField === 'string') {
      title = titleField;
    } else if (titleField?._text) {
      title = titleField._text;
    } else if (Array.isArray(titleField)) {
      title = titleField[0]?._text || titleField[0] || '';
    }

    // Extract type (wet, amvb, etc.)
    let lawType = '';
    const typeField = meta['overheidbwb:soortRegeling'] || meta['soortRegeling'] ||
                      enrichedData['overheidbwb:soortRegeling'] || enrichedData['soortRegeling'];
    if (typeof typeField === 'string') {
      lawType = typeField;
    } else if (typeField?._text) {
      lawType = typeField._text;
    }

    // Extract publisher
    let publisher = '';
    const publisherField = owmsMeta['dcterms:creator'] || owmsMeta['creator'];
    if (typeof publisherField === 'string') {
      publisher = publisherField;
    } else if (publisherField?._text) {
      publisher = publisherField._text;
    }

    // Extract modification date
    let dateModified = '';
    const dateField = owmsMeta['dcterms:modified'] || owmsMeta['modified'] ||
                      enrichedData['dcterms:modified'] || enrichedData['modified'];
    if (typeof dateField === 'string') {
      dateModified = dateField;
    } else if (dateField?._text) {
      dateModified = dateField._text;
    }

    return {
      bwbId,
      title: title || `Regeling ${bwbId}`,
      lawType: lawType || undefined,
      publisher: publisher || undefined,
      dateModified: dateModified || undefined,
      isSelected: false,
    };
  } catch (error) {
    console.error('[KOOP SRU] Error parsing record:', error);
    return null;
  }
}

/**
 * Get current valid version of a specific regulation
 * @param bwbId - BWB identifier (e.g., BWBR0001840)
 * @param validityDate - Date to check validity (defaults to today)
 */
export async function getValidRegulationVersion(
  bwbId: string,
  validityDate: string = new Date().toISOString().split('T')[0]
): Promise<{ xmlUrl: string; validFrom: string; validTo: string | null } | null> {
  try {
    // Query for specific BWB ID with validity date
    const query = `dcterms.identifier=${bwbId} AND overheidbwb.geldigheidsdatum=${validityDate}`;
    
    const params = new URLSearchParams({
      'x-connection': BWB_CONNECTION,
      'operation': 'searchRetrieve',
      'version': '2.0',
      'query': query,
      'maximumRecords': '1',
    });

    const url = `${SRU_BASE_URL}?${params.toString()}`;
    console.log(`[KOOP SRU] Getting valid version for ${bwbId}: ${url}`);

    const response = await axios.get(url, { timeout: 30000 });
    const parsed = xmlParser.parse(response.data);

    // Navigate to record
    const searchResponse = parsed['sru:searchRetrieveResponse'] || parsed['searchRetrieveResponse'] || parsed;
    const records = searchResponse['sru:records']?.['sru:record'] || 
                    searchResponse['records']?.['record'];

    if (!records) {
      console.log(`[KOOP SRU] No valid version found for ${bwbId} on ${validityDate}`);
      return null;
    }

    const record = Array.isArray(records) ? records[0] : records;
    const recordData = record['sru:recordData'] || record['recordData'] || record;
    const gzd = recordData['gzd:gzd'] || recordData['gzd'] || recordData;
    const enrichedData = gzd['gzd:enrichedData'] || gzd['enrichedData'] || {};

    // Extract XML URL for the consolidated text (toestand)
    let xmlUrl = '';
    const manifestation = enrichedData['overheidbwb:manifestation'] || enrichedData['manifestation'];
    
    if (manifestation) {
      const manifestations = Array.isArray(manifestation) ? manifestation : [manifestation];
      for (const m of manifestations) {
        const format = m['dcterms:format'] || m['format'];
        const url = m['dcterms:identifier'] || m['identifier'] || m['@_href'] || m['_text'];
        if (format?.includes('xml') || (typeof url === 'string' && url.endsWith('.xml'))) {
          xmlUrl = typeof url === 'string' ? url : url?._text || '';
          break;
        }
      }
    }

    // Alternative: construct URL from BWB ID
    if (!xmlUrl) {
      xmlUrl = `https://wetten.overheid.nl/${bwbId}/xml`;
    }

    // Extract validity dates
    let validFrom = '';
    let validTo: string | null = null;

    const geldigheid = enrichedData['overheidbwb:geldigheid'] || enrichedData['geldigheid'] || {};
    const startDate = geldigheid['overheidbwb:start'] || geldigheid['start'];
    const endDate = geldigheid['overheidbwb:einde'] || geldigheid['einde'];

    if (typeof startDate === 'string') {
      validFrom = startDate;
    } else if (startDate?._text) {
      validFrom = startDate._text;
    }

    if (typeof endDate === 'string') {
      validTo = endDate;
    } else if (endDate?._text) {
      validTo = endDate._text;
    }

    console.log(`[KOOP SRU] Found version: ${xmlUrl}, valid from ${validFrom} to ${validTo || 'ongoing'}`);

    return {
      xmlUrl,
      validFrom: validFrom || validityDate,
      validTo,
    };
  } catch (error: any) {
    console.error(`[KOOP SRU] Error getting version for ${bwbId}:`, error.message);
    throw new Error(`Fout bij ophalen versie ${bwbId}: ${error.message}`);
  }
}

/**
 * Download and parse legislation XML
 * @param bwbId - BWB identifier
 * @param xmlUrl - URL to XML content (optional, will be constructed if not provided)
 */
export async function downloadLegislationXml(
  bwbId: string,
  xmlUrl?: string
): Promise<{ content: string; hash: string }> {
  try {
    // Construct URL if not provided
    const url = xmlUrl || `https://wetten.overheid.nl/${bwbId}/xml`;
    console.log(`[KOOP XML] Downloading: ${url}`);

    const response = await axios.get(url, {
      timeout: 60000,
      headers: {
        'Accept': 'application/xml, text/xml',
      },
      maxContentLength: 50 * 1024 * 1024, // 50MB max
    });

    const content = response.data;
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    console.log(`[KOOP XML] Downloaded ${bwbId}: ${content.length} bytes, hash: ${hash.substring(0, 16)}...`);

    return { content, hash };
  } catch (error: any) {
    console.error(`[KOOP XML] Download error for ${bwbId}:`, error.message);
    throw new Error(`Fout bij downloaden ${bwbId}: ${error.message}`);
  }
}

/**
 * Parse legislation XML and extract chunks at article/paragraph level
 * Target chunk size: 200-500 words, aligned with article/paragraph boundaries
 */
export function parseLegislationToChunks(
  xmlContent: string,
  bwbId: string,
  title: string,
  validFrom: string,
  validTo: string | null
): LawChunk[] {
  const chunks: LawChunk[] = [];
  const isCurrent = !validTo || new Date(validTo) >= new Date();

  try {
    const parsed = xmlParser.parse(xmlContent);
    
    // Find the main legislation content
    // BWB XML structure: wetgeving > wet-besluit > wettekst > artikel
    const wetgeving = parsed['wetgeving'] || parsed['wet'] || parsed;
    const wetBesluit = wetgeving['wet-besluit'] || wetgeving['regeling'] || wetgeving;
    const wettekst = wetBesluit['wettekst'] || wetBesluit['regeling-tekst'] || wetBesluit;

    // Find all articles
    const articles = findAllArticles(wettekst);
    
    let chunkIndex = 0;
    
    for (const article of articles) {
      const articleNumber = article.number || `${chunkIndex + 1}`;
      const articleTitle = article.title || '';
      const articleContent = article.content || '';
      
      // Check if article is small enough for one chunk (< 500 words)
      const wordCount = articleContent.split(/\s+/).length;
      
      if (wordCount <= 500) {
        // Single chunk for this article
        chunks.push({
          id: `${bwbId}#art${articleNumber}#${validFrom}`,
          text: formatChunkText(articleNumber, articleTitle, articleContent),
          bwbId,
          title,
          articleNumber,
          sectionTitle: articleTitle,
          validFrom,
          validTo: validTo || undefined,
          isCurrent,
          chunkIndex,
        });
        chunkIndex++;
      } else {
        // Split by paragraphs (leden)
        const paragraphs = article.paragraphs || [];
        
        if (paragraphs.length > 0) {
          for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            chunks.push({
              id: `${bwbId}#art${articleNumber}#lid${para.number || i + 1}#${validFrom}`,
              text: formatChunkText(articleNumber, articleTitle, para.content, para.number),
              bwbId,
              title,
              articleNumber,
              paragraphNumber: para.number?.toString() || (i + 1).toString(),
              sectionTitle: articleTitle,
              validFrom,
              validTo: validTo || undefined,
              isCurrent,
              chunkIndex,
            });
            chunkIndex++;
          }
        } else {
          // No paragraphs, split by size
          const textChunks = splitTextBySize(articleContent, 400);
          for (let i = 0; i < textChunks.length; i++) {
            chunks.push({
              id: `${bwbId}#art${articleNumber}#chunk${i + 1}#${validFrom}`,
              text: formatChunkText(articleNumber, articleTitle, textChunks[i]),
              bwbId,
              title,
              articleNumber,
              paragraphNumber: textChunks.length > 1 ? `deel${i + 1}` : undefined,
              sectionTitle: articleTitle,
              validFrom,
              validTo: validTo || undefined,
              isCurrent,
              chunkIndex,
            });
            chunkIndex++;
          }
        }
      }
    }

    // If no articles found, try to extract any text content
    if (chunks.length === 0) {
      const allText = extractAllText(wetgeving);
      if (allText.length > 50) {
        const textChunks = splitTextBySize(allText, 400);
        for (let i = 0; i < textChunks.length; i++) {
          chunks.push({
            id: `${bwbId}#chunk${i + 1}#${validFrom}`,
            text: `${title}\n\n${textChunks[i]}`,
            bwbId,
            title,
            validFrom,
            validTo: validTo || undefined,
            isCurrent,
            chunkIndex: i,
          });
        }
      }
    }

    // Set total chunks count
    const totalChunks = chunks.length;
    for (const chunk of chunks) {
      chunk.totalChunks = totalChunks;
    }

    console.log(`[KOOP Parse] ${bwbId}: Extracted ${chunks.length} chunks`);
    return chunks;
  } catch (error: any) {
    console.error(`[KOOP Parse] Error parsing ${bwbId}:`, error.message);
    
    // Return a single chunk with raw content as fallback
    const rawText = xmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const textChunks = splitTextBySize(rawText.substring(0, 10000), 400);
    
    return textChunks.map((text, i) => ({
      id: `${bwbId}#fallback${i + 1}#${validFrom}`,
      text: `${title}\n\n${text}`,
      bwbId,
      title,
      validFrom,
      validTo: validTo || undefined,
      isCurrent,
      chunkIndex: i,
      totalChunks: textChunks.length,
    }));
  }
}

interface ArticleData {
  number: string;
  title: string;
  content: string;
  paragraphs: { number: string; content: string }[];
}

/**
 * Find all articles in the legislation structure
 */
function findAllArticles(node: any, articles: ArticleData[] = []): ArticleData[] {
  if (!node || typeof node !== 'object') return articles;

  // Check if this is an article node
  if (node['artikel'] || node['article']) {
    const artikel = node['artikel'] || node['article'];
    const artikelArray = Array.isArray(artikel) ? artikel : [artikel];
    
    for (const art of artikelArray) {
      const articleData = parseArticle(art);
      if (articleData) {
        articles.push(articleData);
      }
    }
  }

  // Recursively search in children
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '_text') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        findAllArticles(item, articles);
      }
    } else if (typeof child === 'object') {
      findAllArticles(child, articles);
    }
  }

  return articles;
}

/**
 * Parse a single article node
 */
function parseArticle(node: any): ArticleData | null {
  if (!node) return null;

  // Extract article number
  let number = '';
  const kop = node['kop'] || {};
  const nr = kop['nr'] || node['@_nr'] || node['nr'];
  if (typeof nr === 'string') {
    number = nr;
  } else if (nr?._text) {
    number = nr._text;
  }

  // Extract article title
  let title = '';
  const tit = kop['titel'] || kop['title'] || '';
  if (typeof tit === 'string') {
    title = tit;
  } else if (tit?._text) {
    title = tit._text;
  }

  // Extract content
  let content = '';
  const paragraphs: { number: string; content: string }[] = [];

  // Look for 'lid' (paragraph) elements
  const leden = node['lid'] || [];
  const ledenArray = Array.isArray(leden) ? leden : (leden ? [leden] : []);

  for (const lid of ledenArray) {
    const lidNr = lid['@_nr'] || lid['lidnr'] || '';
    const lidContent = extractAllText(lid);
    
    if (lidContent) {
      paragraphs.push({
        number: typeof lidNr === 'string' ? lidNr : lidNr?._text || '',
        content: lidContent,
      });
    }
  }

  // If no leden, extract all text from article
  if (paragraphs.length === 0) {
    content = extractAllText(node);
  } else {
    content = paragraphs.map(p => p.content).join('\n');
  }

  if (!content && paragraphs.length === 0) return null;

  return { number, title, content, paragraphs };
}

/**
 * Extract all text content from a node
 */
function extractAllText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return node.toString();

  let text = '';
  
  if (node._text) {
    text += node._text + ' ';
  }

  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '_text') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        text += extractAllText(item) + ' ';
      }
    } else {
      text += extractAllText(child) + ' ';
    }
  }

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Format chunk text with article number and title
 */
function formatChunkText(
  articleNumber: string,
  articleTitle: string,
  content: string,
  paragraphNumber?: string
): string {
  let header = `Artikel ${articleNumber}`;
  if (articleTitle) {
    header += ` - ${articleTitle}`;
  }
  if (paragraphNumber) {
    header += `\nLid ${paragraphNumber}`;
  }
  return `${header}\n\n${content}`;
}

/**
 * Split text into chunks of approximately target word count
 */
function splitTextBySize(text: string, targetWords: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  
  for (let i = 0; i < words.length; i += targetWords) {
    const chunk = words.slice(i, i + targetWords).join(' ');
    if (chunk.length > 10) {
      chunks.push(chunk);
    }
  }
  
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Build search query for specific law types
 */
export function buildLawTypeQuery(lawTypes: string[]): string {
  if (!lawTypes || lawTypes.length === 0) {
    return '*';
  }
  
  const typeQueries = lawTypes.map(type => `overheidbwb.soortRegeling=${type}`);
  return typeQueries.join(' OR ');
}

/**
 * Calculate hash for duplicate detection
 */
export function calculateLawHash(bwbId: string, validFrom: string, validTo: string | null, xmlHash: string): string {
  const input = `${bwbId}|${validFrom}|${validTo || 'open'}|${xmlHash}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}
