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
import https from 'https';
import type { BwbRegulation, LawChunk } from '@shared/schema';

const SRU_BASE_URL = 'https://zoekservice.overheid.nl/sru/Search';
const BWB_CONNECTION = 'BWB';

// XML Parser configuration for SRU responses
// IMPORTANT: parseAttributeValue AND parseTagValue must be false to preserve article numbers
// parseAttributeValue: false - prevents attribute values like status="2.20" from becoming 2.2
// parseTagValue: false - prevents text content like <nr>2.20</nr> from becoming 2.2
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '_text',
  parseAttributeValue: false,
  parseTagValue: false,
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
 * @param excludeBES - Exclude BES (Bonaire, Sint Eustatius, Saba) regulations
 * 
 * CQL Query Examples:
 * - All regulations since 2000: dcterms.modified>=2000-01-01
 * - Specific BWB ID: dcterms.identifier=BWBR0001840
 * - By type: dcterms.type=wet
 * - Search in title: dcterms.title any "burgerlijk"
 */
export async function searchBwbRegulations(
  query: string = '*',
  startRecord: number = 1,
  maxRecords: number = 100,
  excludeBES: boolean = true
): Promise<SruSearchResult> {
  try {
    // Build effective CQL query
    // The SRU API doesn't support wildcard (*), so we use a date filter to get all records
    let effectiveQuery = query;
    if (query === '*' || query === '' || !query) {
      // Default: all regulations (using a date that captures everything)
      effectiveQuery = 'dcterms.modified>=1900-01-01';
    } else if (!query.includes('=') && !query.includes('>') && !query.includes('<')) {
      // If it's a simple search term, search in title/identifier
      // First try to detect if it's a BWB ID
      if (query.match(/^BWBR\d+$/i)) {
        effectiveQuery = `dcterms.identifier=${query.toUpperCase()}`;
      } else {
        // Use overheidbwb.titel with 'all' relation for free text search
        // BWB SRU supports: =, adj, any, all operators for titel field
        // 'all' matches all terms in the query across title fields (citeertitel, officiële-titel, niet-officiële-titel)
        effectiveQuery = `overheidbwb.titel all "${query}"`;
      }
    }
    
    // Add BES filter if requested (exclude Bonaire, Sint Eustatius, Saba regulations)
    // BES regulations have dcterms.type containing "-BES" suffix (e.g., "wet-BES", "amvb-BES")
    if (excludeBES) {
      effectiveQuery = `(${effectiveQuery}) not dcterms.type = wet-BES not dcterms.type = amvb-BES not dcterms.type = ministeriele-regeling-BES`;
    }
    
    // Build SRU request URL
    const params = new URLSearchParams({
      'x-connection': BWB_CONNECTION,
      'operation': 'searchRetrieve',
      'version': '2.0',
      'query': effectiveQuery,
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
    // CRITICAL: Use == for exact match on identifier, lowercase 'and' for boolean
    const query = `dcterms.identifier==${bwbId} and overheidbwb.geldigheidsdatum=${validityDate}`;
    
    // CRITICAL: URLSearchParams encodes spaces as '+' which KOOP SRU rejects (406)
    // encodeURIComponent encodes '=' as '%3D' which also causes 406
    // axios and fetch both re-encode the URL which causes 406
    // Solution: Use native https module which preserves exact URL encoding
    const encodedQuery = query.replace(/ /g, '%20');
    const fullUrl = `${SRU_BASE_URL}?x-connection=${BWB_CONNECTION}&operation=searchRetrieve&version=2.0&query=${encodedQuery}&maximumRecords=1`;
    console.log(`[KOOP SRU] Getting valid version for ${bwbId}: ${fullUrl}`);

    // Use native https module to preserve exact URL encoding (fetch/axios re-encode and cause 406)
    const data = await new Promise<string>((resolve, reject) => {
      const parsedUrl = new URL(fullUrl);
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        timeout: 30000
      };
      
      const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Request failed with status code ${res.statusCode}`));
          return;
        }
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => resolve(responseData));
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
    
    const parsed = xmlParser.parse(data);

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
    
    // Extract from originalData for validity dates
    const originalData = gzd['originalData'] || gzd['gzd:originalData'] || {};
    const meta = originalData['overheidbwb:meta'] || originalData['meta'] || {};
    const bwbipm = meta['bwbipm'] || meta['overheidbwb:bwbipm'] || {};
    
    // Extract from enrichedData for XML URL
    const enrichedData = gzd['enrichedData'] || gzd['gzd:enrichedData'] || {};

    // Extract XML URL from locatie_toestand (repository URL)
    let xmlUrl = enrichedData['overheidbwb:locatie_toestand'] || enrichedData['locatie_toestand'] || '';
    
    if (typeof xmlUrl !== 'string') {
      xmlUrl = xmlUrl?._text || xmlUrl?.['#text'] || '';
    }

    // Fallback: try manifestation
    if (!xmlUrl) {
      const manifestation = enrichedData['overheidbwb:manifestation'] || enrichedData['manifestation'];
      if (manifestation) {
        const manifestations = Array.isArray(manifestation) ? manifestation : [manifestation];
        for (const m of manifestations) {
          const format = m['dcterms:format'] || m['format'];
          const mUrl = m['dcterms:identifier'] || m['identifier'] || m['@_href'] || m['_text'];
          if (format?.includes('xml') || (typeof mUrl === 'string' && mUrl.endsWith('.xml'))) {
            xmlUrl = typeof mUrl === 'string' ? mUrl : mUrl?._text || '';
            break;
          }
        }
      }
    }

    // Last fallback: construct from BWB ID and validity date
    if (!xmlUrl) {
      xmlUrl = `https://repository.officiele-overheidspublicaties.nl/bwb/${bwbId}/${validityDate}_0/xml/${bwbId}_${validityDate}_0.xml`;
    }

    // Extract validity dates from bwbipm
    let validFrom = '';
    let validTo: string | null = null;

    const startDate = bwbipm['overheidbwb:geldigheidsperiode_startdatum'] || bwbipm['geldigheidsperiode_startdatum'];
    const endDate = bwbipm['overheidbwb:geldigheidsperiode_einddatum'] || bwbipm['geldigheidsperiode_einddatum'];

    if (typeof startDate === 'string') {
      validFrom = startDate;
    } else if (startDate?._text) {
      validFrom = startDate._text;
    }

    if (typeof endDate === 'string') {
      validTo = endDate === '9999-12-31' ? null : endDate;
    } else if (endDate?._text) {
      validTo = endDate._text === '9999-12-31' ? null : endDate._text;
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
 * Download and parse legislation XML from official KOOP repository
 * Uses repository.officiele-overheidspublicaties.nl for pure XML content
 * (wetten.overheid.nl/xml returns HTML, not valid BWB XML)
 * 
 * @param bwbId - BWB identifier
 * @param xmlUrl - URL to XML content (optional, will construct repository URL if not provided)
 * @param validityDate - Date for which to get the valid version (defaults to today)
 */
export async function downloadLegislationXml(
  bwbId: string,
  xmlUrl?: string,
  validityDate?: string
): Promise<{ content: string; hash: string }> {
  try {
    // Construct repository URL if not provided
    // Format: https://repository.officiele-overheidspublicaties.nl/bwb/{BWBID}/geldend/{date}/{BWBID}.xml
    const date = validityDate || new Date().toISOString().split('T')[0];
    const repositoryUrl = `https://repository.officiele-overheidspublicaties.nl/bwb/${bwbId}/geldend/${date}/${bwbId}.xml`;
    const url = xmlUrl || repositoryUrl;
    
    console.log(`[KOOP XML] Downloading: ${url}`);

    const response = await axios.get(url, {
      timeout: 60000,
      headers: {
        'Accept': 'application/xml, text/xml',
      },
      maxContentLength: 50 * 1024 * 1024, // 50MB max
      maxRedirects: 5,
    });

    const content = response.data;
    
    // Verify we got XML, not HTML (common issue with wetten.overheid.nl)
    if (typeof content === 'string' && content.trim().startsWith('<!DOCTYPE HTML')) {
      console.error(`[KOOP XML] Received HTML instead of XML for ${bwbId}, trying repository URL...`);
      
      // Try repository URL as fallback
      if (url !== repositoryUrl) {
        console.log(`[KOOP XML] Retrying with repository URL: ${repositoryUrl}`);
        const retryResponse = await axios.get(repositoryUrl, {
          timeout: 60000,
          headers: { 'Accept': 'application/xml, text/xml' },
          maxContentLength: 50 * 1024 * 1024,
          maxRedirects: 5,
        });
        const retryContent = retryResponse.data;
        const hash = crypto.createHash('sha256').update(retryContent).digest('hex');
        console.log(`[KOOP XML] Downloaded ${bwbId}: ${retryContent.length} bytes, hash: ${hash.substring(0, 16)}...`);
        return { content: retryContent, hash };
      }
      throw new Error('Ontvangen HTML in plaats van XML');
    }
    
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
 * Now includes full hierarchical structure: boek, titel, afdeling, paragraaf
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
    // BWB XML has different structures for different document types:
    // - Wetten: wetgeving > wet-besluit > wettekst > artikel
    // - Verdragen: toestand > wetgeving > verdrag > verdragtekst[] > wettekst > artikel
    // - Regelingen: wetgeving > regeling > regeling-tekst > artikel
    
    // Handle 'toestand' wrapper (used by verdragen/treaties)
    let root = parsed['toestand'] || parsed;
    const wetgeving = root['wetgeving'] || root['wet'] || root;
    
    // Handle verdrag (treaty) structure - may have multiple verdragtekst elements
    // These contain: Verdrag, Uitvoeringsreglement, Protocol, etc.
    const verdrag = wetgeving['verdrag'];
    
    let articles: ArticleWithHierarchy[] = [];
    
    if (verdrag) {
      // This is a treaty - parse all verdragtekst sections
      console.log(`[KOOP Parse] ${bwbId}: Detected treaty structure (verdrag)`);
      
      const verdragteksten = verdrag['verdragtekst'];
      const verdragtekstArray = Array.isArray(verdragteksten) ? verdragteksten : (verdragteksten ? [verdragteksten] : []);
      
      for (let i = 0; i < verdragtekstArray.length; i++) {
        const verdragtekst = verdragtekstArray[i];
        const wettekst = verdragtekst['wettekst'] || verdragtekst['regeling-tekst'] || verdragtekst;
        
        // Get the name of this treaty part (e.g., "Verdrag", "Uitvoeringsreglement", "Protocol")
        const kop = verdragtekst['kop'] || {};
        const partLabel = kop['label'] || kop['titel'] || `Deel ${i + 1}`;
        const partLabelStr = typeof partLabel === 'object' ? (partLabel['#text'] || partLabel['_text'] || JSON.stringify(partLabel)) : String(partLabel);
        
        console.log(`[KOOP Parse] Processing treaty part ${i + 1}: ${partLabelStr}`);
        
        // Create a context with the treaty part information
        const partContext: HierarchyContext = {
          // Use boekNummer/Titel to store the treaty part for structure path
          boekNummer: `verdragtekst${i + 1}`,
          boekTitel: partLabelStr,
        };
        
        // Find articles in this treaty part
        const partArticles = findAllArticlesWithHierarchy(wettekst, partContext);
        console.log(`[KOOP Parse] Found ${partArticles.length} articles in ${partLabelStr}`);
        articles.push(...partArticles);
      }
      
      // Also check for bijlagen (annexes) in verdrag
      if (verdrag['bijlage']) {
        const bijlagen = Array.isArray(verdrag['bijlage']) ? verdrag['bijlage'] : [verdrag['bijlage']];
        for (let i = 0; i < bijlagen.length; i++) {
          const bijlage = bijlagen[i];
          const kop = bijlage['kop'] || {};
          const bijlageLabel = kop['label'] || kop['titel'] || `Bijlage ${i + 1}`;
          const bijlageLabelStr = typeof bijlageLabel === 'object' ? (bijlageLabel['#text'] || bijlageLabel['_text'] || JSON.stringify(bijlageLabel)) : String(bijlageLabel);
          
          console.log(`[KOOP Parse] Processing bijlage: ${bijlageLabelStr}`);
          
          const bijlageContext: HierarchyContext = {
            boekNummer: `bijlage${i + 1}`,
            boekTitel: bijlageLabelStr,
          };
          
          const wettekst = bijlage['wettekst'] || bijlage['regeling-tekst'] || bijlage;
          const bijlageArticles = findAllArticlesWithHierarchy(wettekst, bijlageContext);
          console.log(`[KOOP Parse] Found ${bijlageArticles.length} articles in ${bijlageLabelStr}`);
          articles.push(...bijlageArticles);
        }
      }
    } else {
      // Standard wet-besluit structure
      const wetBesluit = wetgeving['wet-besluit'] || wetgeving['regeling'] || wetgeving;
      const wettekst = wetBesluit['wettekst'] || wetBesluit['regeling-tekst'] || wetBesluit;
      
      // Find all articles WITH their hierarchical context
      articles = findAllArticlesWithHierarchy(wettekst);
      
      // Also check for bijlagen in wet-besluit
      if (wetBesluit['bijlage']) {
        const bijlagen = Array.isArray(wetBesluit['bijlage']) ? wetBesluit['bijlage'] : [wetBesluit['bijlage']];
        for (let i = 0; i < bijlagen.length; i++) {
          const bijlage = bijlagen[i];
          const kop = bijlage['kop'] || {};
          const bijlageLabel = kop['label'] || kop['titel'] || `Bijlage ${i + 1}`;
          const bijlageLabelStr = typeof bijlageLabel === 'object' ? (bijlageLabel['#text'] || bijlageLabel['_text'] || JSON.stringify(bijlageLabel)) : String(bijlageLabel);
          
          const bijlageContext: HierarchyContext = {
            boekNummer: `bijlage${i + 1}`,
            boekTitel: bijlageLabelStr,
          };
          
          const bijlageWettekst = bijlage['wettekst'] || bijlage['regeling-tekst'] || bijlage;
          const bijlageArticles = findAllArticlesWithHierarchy(bijlageWettekst, bijlageContext);
          articles.push(...bijlageArticles);
        }
      }
    }
    
    let chunkIndex = 0;
    
    for (const article of articles) {
      const articleNumber = article.number || `${chunkIndex + 1}`;
      const articleTitle = article.title || '';
      const articleContent = article.content || '';
      const hierarchy = article.hierarchy;
      const structurePath = buildStructurePath(hierarchy);
      
      // Base chunk data with hierarchy
      const baseChunkData = {
        bwbId,
        title,
        articleNumber,
        sectionTitle: articleTitle,
        validFrom,
        validTo: validTo || undefined,
        isCurrent,
        // Hierarchical structure
        boekNummer: hierarchy.boekNummer,
        boekTitel: hierarchy.boekTitel,
        titelNummer: hierarchy.titelNummer,
        titelNaam: hierarchy.titelNaam,
        afdelingNummer: hierarchy.afdelingNummer,
        afdelingNaam: hierarchy.afdelingNaam,
        paragraafNummer: hierarchy.paragraafNummer,
        paragraafNaam: hierarchy.paragraafNaam,
        structurePath: structurePath || undefined,
      };
      
      // Check if article is small enough for one chunk (< 500 words)
      const wordCount = articleContent.split(/\s+/).length;
      
      // Build unique ID suffix from structure path to handle documents with multiple
      // sections containing the same article number (e.g., Verdrag + Uitvoeringsreglement)
      // This prevents duplicate articles from overwriting each other in Pinecone
      const structureIdSuffix = structurePath ? `@${structurePath.replace(/\|/g, '_')}` : '';
      
      if (wordCount <= 500) {
        // Single chunk for this article
        chunks.push({
          ...baseChunkData,
          id: `${bwbId}#art${articleNumber}${structureIdSuffix}#${validFrom}`,
          text: formatChunkTextWithHierarchy(articleNumber, articleTitle, articleContent, hierarchy),
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
              ...baseChunkData,
              id: `${bwbId}#art${articleNumber}#lid${para.number || i + 1}${structureIdSuffix}#${validFrom}`,
              text: formatChunkTextWithHierarchy(articleNumber, articleTitle, para.content, hierarchy, para.number),
              paragraphNumber: para.number?.toString() || (i + 1).toString(),
              chunkIndex,
            });
            chunkIndex++;
          }
        } else {
          // No paragraphs, split by size
          const textChunks = splitTextBySize(articleContent, 400);
          for (let i = 0; i < textChunks.length; i++) {
            chunks.push({
              ...baseChunkData,
              id: `${bwbId}#art${articleNumber}#chunk${i + 1}${structureIdSuffix}#${validFrom}`,
              text: formatChunkTextWithHierarchy(articleNumber, articleTitle, textChunks[i], hierarchy),
              paragraphNumber: textChunks.length > 1 ? `deel${i + 1}` : undefined,
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

    // Log hierarchy stats
    const withHierarchy = chunks.filter(c => c.structurePath).length;
    console.log(`[KOOP Parse] ${bwbId}: Extracted ${chunks.length} chunks (${withHierarchy} with hierarchy)`);
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

/**
 * Hierarchical context tracking during XML traversal
 * Dutch law structure: Boek > Titel > Afdeling > Paragraaf > Artikel > Lid
 */
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

/**
 * Build structure path for filtering (e.g., "boek:7|titel:4|afdeling:1")
 */
function buildStructurePath(hierarchy: HierarchyContext): string {
  const parts: string[] = [];
  if (hierarchy.boekNummer) parts.push(`boek:${hierarchy.boekNummer}`);
  if (hierarchy.titelNummer) parts.push(`titel:${hierarchy.titelNummer}`);
  if (hierarchy.afdelingNummer) parts.push(`afdeling:${hierarchy.afdelingNummer}`);
  if (hierarchy.paragraafNummer) parts.push(`paragraaf:${hierarchy.paragraafNummer}`);
  return parts.join('|');
}

/**
 * Safely convert any value to string
 */
function toSafeString(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return val.toString();
  if (val._text) return toSafeString(val._text);
  if (val['#text']) return toSafeString(val['#text']);
  return '';
}

/**
 * Extract number and title from a structural element's 'kop' (header)
 */
function extractKopInfo(node: any): { nummer: string; naam: string } {
  const kop = node['kop'] || {};
  
  // Extract number
  const nr = kop['nr'] || node['@_nr'] || node['nr'] || '';
  const nummer = toSafeString(nr);
  
  // Extract title/name
  const titel = kop['titel'] || kop['title'] || kop['label'] || '';
  const naam = toSafeString(titel);
  
  return { nummer, naam };
}

/**
 * Recursively find all articles with their hierarchical context
 * Tracks boek, titel, afdeling, paragraaf as we descend the XML tree
 */
function findAllArticlesWithHierarchy(
  node: any,
  context: HierarchyContext = {},
  articles: ArticleWithHierarchy[] = []
): ArticleWithHierarchy[] {
  if (!node || typeof node !== 'object') return articles;

  // Create a copy of context to modify for this level
  let currentContext = { ...context };

  // Check for structural elements and update context
  // BWB XML uses: boek, hoofdstuk, titel, afdeling, paragraaf
  
  // Boek (Book)
  if (node['boek']) {
    const boeken = Array.isArray(node['boek']) ? node['boek'] : [node['boek']];
    for (const boek of boeken) {
      const info = extractKopInfo(boek);
      const boekContext = { 
        ...currentContext, 
        boekNummer: info.nummer || currentContext.boekNummer,
        boekTitel: info.naam || currentContext.boekTitel,
        // Reset lower levels when entering a new book
        titelNummer: undefined,
        titelNaam: undefined,
        afdelingNummer: undefined,
        afdelingNaam: undefined,
        paragraafNummer: undefined,
        paragraafNaam: undefined,
      };
      findAllArticlesWithHierarchy(boek, boekContext, articles);
    }
  }

  // Titeldeel (Title Part) - BWB uses this instead of "titel" for chapters
  if (node['titeldeel']) {
    const titeldelen = Array.isArray(node['titeldeel']) ? node['titeldeel'] : [node['titeldeel']];
    for (const titeldeel of titeldelen) {
      const info = extractKopInfo(titeldeel);
      const titelContext = { 
        ...currentContext, 
        titelNummer: info.nummer || currentContext.titelNummer,
        titelNaam: info.naam || currentContext.titelNaam,
        afdelingNummer: undefined,
        afdelingNaam: undefined,
        paragraafNummer: undefined,
        paragraafNaam: undefined,
      };
      findAllArticlesWithHierarchy(titeldeel, titelContext, articles);
    }
  }
  
  // Hoofdstuk (Chapter) - alternative structure used in some laws
  if (node['hoofdstuk']) {
    const hoofdstukken = Array.isArray(node['hoofdstuk']) ? node['hoofdstuk'] : [node['hoofdstuk']];
    for (const hoofdstuk of hoofdstukken) {
      const info = extractKopInfo(hoofdstuk);
      const hoofdstukContext = { 
        ...currentContext, 
        titelNummer: info.nummer || currentContext.titelNummer,
        titelNaam: info.naam || currentContext.titelNaam,
        afdelingNummer: undefined,
        afdelingNaam: undefined,
        paragraafNummer: undefined,
        paragraafNaam: undefined,
      };
      findAllArticlesWithHierarchy(hoofdstuk, hoofdstukContext, articles);
    }
  }

  // Titel (Title/Chapter) - some laws use this directly
  if (node['titel'] && typeof node['titel'] === 'object') {
    const titels = Array.isArray(node['titel']) ? node['titel'] : [node['titel']];
    for (const titel of titels) {
      // Check if this is a structural titel element (has children) or just text
      if (typeof titel === 'object' && (titel['artikel'] || titel['afdeling'] || titel['paragraaf'] || titel['kop'])) {
        const info = extractKopInfo(titel);
        const titelContext = { 
          ...currentContext, 
          titelNummer: info.nummer || currentContext.titelNummer,
          titelNaam: info.naam || currentContext.titelNaam,
          afdelingNummer: undefined,
          afdelingNaam: undefined,
          paragraafNummer: undefined,
          paragraafNaam: undefined,
        };
        findAllArticlesWithHierarchy(titel, titelContext, articles);
      }
    }
  }

  // Afdeling (Section)
  if (node['afdeling']) {
    const afdelingen = Array.isArray(node['afdeling']) ? node['afdeling'] : [node['afdeling']];
    for (const afdeling of afdelingen) {
      const info = extractKopInfo(afdeling);
      const afdelingContext = { 
        ...currentContext, 
        afdelingNummer: info.nummer || currentContext.afdelingNummer,
        afdelingNaam: info.naam || currentContext.afdelingNaam,
        paragraafNummer: undefined,
        paragraafNaam: undefined,
      };
      findAllArticlesWithHierarchy(afdeling, afdelingContext, articles);
    }
  }

  // Paragraaf (Subsection) - note: this is different from 'lid' (paragraph within article)
  if (node['paragraaf']) {
    const paragrafen = Array.isArray(node['paragraaf']) ? node['paragraaf'] : [node['paragraaf']];
    for (const paragraaf of paragrafen) {
      const info = extractKopInfo(paragraaf);
      const paragraafContext = { 
        ...currentContext, 
        paragraafNummer: info.nummer || currentContext.paragraafNummer,
        paragraafNaam: info.naam || currentContext.paragraafNaam,
      };
      findAllArticlesWithHierarchy(paragraaf, paragraafContext, articles);
    }
  }

  // Check if this node contains articles
  if (node['artikel'] || node['article']) {
    const artikelen = node['artikel'] || node['article'];
    const artikelArray = Array.isArray(artikelen) ? artikelen : [artikelen];
    
    for (const art of artikelArray) {
      const articleData = parseArticleWithHierarchy(art, currentContext);
      if (articleData) {
        articles.push(articleData);
      }
    }
  }

  // Recursively search other children (skip already processed structural elements)
  const processedKeys = new Set(['boek', 'titeldeel', 'hoofdstuk', 'titel', 'afdeling', 'paragraaf', 'artikel', 'article']);
  
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '_text' || processedKeys.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        findAllArticlesWithHierarchy(item, currentContext, articles);
      }
    } else if (typeof child === 'object') {
      findAllArticlesWithHierarchy(child, currentContext, articles);
    }
  }

  return articles;
}

/**
 * Parse a single article node with its hierarchical context
 */
function parseArticleWithHierarchy(node: any, hierarchy: HierarchyContext): ArticleWithHierarchy | null {
  if (!node) return null;

  // Extract article number
  const kop = node['kop'] || {};
  const nr = kop['nr'] || node['@_nr'] || node['nr'];
  const number = toSafeString(nr);

  // Extract article title
  const tit = kop['titel'] || kop['title'] || '';
  const title = toSafeString(tit);

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

  return { 
    number: number.trim(), 
    title: title.trim(), 
    content, 
    paragraphs,
    hierarchy: { ...hierarchy }
  };
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
 * Format chunk text with full hierarchical context for better AI understanding
 * Includes: Boek > Titel > Afdeling > Paragraaf > Artikel > Lid
 */
function formatChunkTextWithHierarchy(
  articleNumber: string,
  articleTitle: string,
  content: string,
  hierarchy: HierarchyContext,
  paragraphNumber?: string
): string {
  const lines: string[] = [];
  
  // Build hierarchical context header
  const contextParts: string[] = [];
  
  if (hierarchy.boekNummer) {
    let boekText = `Boek ${hierarchy.boekNummer}`;
    if (hierarchy.boekTitel) boekText += `: ${hierarchy.boekTitel}`;
    contextParts.push(boekText);
  }
  
  if (hierarchy.titelNummer) {
    let titelText = `Titel ${hierarchy.titelNummer}`;
    if (hierarchy.titelNaam) titelText += `: ${hierarchy.titelNaam}`;
    contextParts.push(titelText);
  }
  
  if (hierarchy.afdelingNummer) {
    let afdelingText = `Afdeling ${hierarchy.afdelingNummer}`;
    if (hierarchy.afdelingNaam) afdelingText += `: ${hierarchy.afdelingNaam}`;
    contextParts.push(afdelingText);
  }
  
  if (hierarchy.paragraafNummer) {
    let paragraafText = `§ ${hierarchy.paragraafNummer}`;
    if (hierarchy.paragraafNaam) paragraafText += `: ${hierarchy.paragraafNaam}`;
    contextParts.push(paragraafText);
  }
  
  // Add hierarchical context if present
  if (contextParts.length > 0) {
    lines.push(contextParts.join(' > '));
    lines.push('');
  }
  
  // Add article header
  let header = `Artikel ${articleNumber}`;
  if (articleTitle) {
    header += ` - ${articleTitle}`;
  }
  lines.push(header);
  
  if (paragraphNumber) {
    lines.push(`Lid ${paragraphNumber}`);
  }
  
  lines.push('');
  lines.push(content);
  
  return lines.join('\n');
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
