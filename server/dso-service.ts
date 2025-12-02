/**
 * DSO Service - Fetches Dutch environmental plans (Omgevingsplannen) from DSO-LV
 * 
 * Uses the Omgevingsdocument Presenteren API v7 (PRE-PRODUCTIE) to query omgevingsplannen.
 * DSO = Digitaal Stelsel Omgevingswet
 * 
 * Endpoints:
 * - Base: https://service.pre.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v7
 * - Search regelingen: /regelingen
 * - Search by location: /regelingen/_zoek
 * 
 * Authentication: API key required (X-Api-Key header)
 * 
 * NOTE: Using PRE-PRODUCTIE environment for testing. Data may differ from production.
 * For production, use: https://service.omgevingswet.overheid.nl/...
 */

import axios from 'axios';
import crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '_text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const DSO_BASE_URL = 'https://service.pre.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v7';

// Document types available in DSO
export const DSO_DOCUMENT_TYPES = [
  { value: 'omgevingsplan', label: 'Omgevingsplan' },
  { value: 'omgevingsverordening', label: 'Omgevingsverordening' },
  { value: 'waterschapsverordening', label: 'Waterschapsverordening' },
  { value: 'omgevingsvisie', label: 'Omgevingsvisie' },
  { value: 'programma', label: 'Programma' },
  { value: 'projectbesluit', label: 'Projectbesluit' },
  { value: 'instructie', label: 'Instructie' },
  { value: 'voorbereidingsbesluit', label: 'Voorbereidingsbesluit' },
];

// Competent authority types
export const DSO_AUTHORITY_TYPES = [
  { value: 'gemeente', label: 'Gemeente' },
  { value: 'provincie', label: 'Provincie' },
  { value: 'waterschap', label: 'Waterschap' },
  { value: 'ministerie', label: 'Ministerie (Rijk)' },
];

// Dutch municipalities list with CBS codes (sample - complete list would be fetched from CBS API)
// Format: GM + 4-digit code
export interface Municipality {
  code: string;       // e.g., "gm0344"
  name: string;       // e.g., "Utrecht"
  province: string;   // e.g., "Utrecht"
}

export interface DsoRegeling {
  identificatie: string;
  officieleTitel: string;
  citeerTitel?: string;
  type: string;
  bevoegdGezag: {
    code: string;
    naam: string;
  };
  dateStart?: string;
  dateEnd?: string;
  status?: string;
  publicatiedatum?: string;
  inwerkingtreding?: string;
  documentUrl?: string;
  xmlUrl?: string;
  isSelected?: boolean;
  isUploaded?: boolean;
}

export interface DsoSearchResult {
  regelingen: DsoRegeling[];
  totalRecords: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Check if DSO API key is configured
 */
export function isDsoApiKeyConfigured(): boolean {
  return !!process.env.DSO_API_KEY;
}

/**
 * Get configured API key
 */
function getApiKey(): string {
  const key = process.env.DSO_API_KEY;
  if (!key) {
    throw new Error('DSO_API_KEY is niet geconfigureerd. Vraag een API-key aan via https://developer.omgevingswet.overheid.nl/formulieren/api-key-aanvragen-0/');
  }
  return key;
}

/**
 * Search for regelingen (environmental regulations/plans)
 * @param options - Search options
 * 
 * NOTE: v7 API uses POST /_zoek for filtering, GET only supports basic pagination
 */
export async function searchRegelingen(options: {
  bevoegdGezag?: string;          // Municipality/authority code (e.g., "gm0344")
  typeBevoegdGezag?: string;      // Authority type: gemeente, provincie, waterschap, ministerie
  documentType?: string;          // Document type filter
  zoekTerm?: string;              // Free text search
  page?: number;
  pageSize?: number;
  geldigOp?: string;              // Valid on date (YYYY-MM-DD)
  inWerkingOp?: string;           // In effect on date (YYYY-MM-DD)
}): Promise<DsoSearchResult> {
  const {
    bevoegdGezag,
    typeBevoegdGezag,
    documentType,
    zoekTerm,
    page = 0,
    pageSize = 50,
    geldigOp,
    inWerkingOp,
  } = options;

  try {
    const apiKey = getApiKey();
    
    // Build query parameters for pagination
    const params = new URLSearchParams();
    params.set('page', page.toString());
    params.set('size', pageSize.toString());
    
    // Time travel parameters
    if (geldigOp) {
      params.set('geldigOp', geldigOp);
    }
    if (inWerkingOp) {
      params.set('inWerkingOp', inWerkingOp);
    }

    // NOTE: v7 PRE-PRODUCTIE API has limited filtering support
    // Filtering by typeBevoegdGezag, documentType, bevoegdGezag is done client-side
    const url = `${DSO_BASE_URL}/regelingen?${params.toString()}`;
    console.log(`[DSO Service] Searching (GET): ${url}`);
    
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'Accept': 'application/hal+json',
        'X-Api-Key': apiKey,
      },
    });

    const data = response.data;
    
    // Parse HAL+JSON response
    const embedded = data._embedded || {};
    const regelingenArray = embedded.regelingen || [];
    const pageInfo = data.page || {};
    
    const regelingen: DsoRegeling[] = regelingenArray.map((item: any) => ({
      identificatie: item.identificatie || '',
      officieleTitel: item.officieleTitel || item.citeertitel || 'Onbekende titel',
      citeerTitel: item.citeertitel,
      type: typeof item.type === 'object' ? (item.type?.waarde || item.type?.code || 'onbekend') : (item.type || 'onbekend'),
      bevoegdGezag: {
        code: item.bevoegdGezag?.code || '',
        naam: item.bevoegdGezag?.naam || item.bevoegdGezag?.bestuurslaag || 'Onbekend',
      },
      dateStart: item.gepibliceerdOp || item.bekendOp,
      status: item.procedurestatus,
      publicatiedatum: item.gepubliceerdOp,
      inwerkingtreding: item.inwerkingtredingsdatum,
      documentUrl: item._links?.self?.href,
      isSelected: false,
      isUploaded: false,
    }));

    return {
      regelingen,
      totalRecords: pageInfo.totalElements || regelingen.length,
      page: pageInfo.number || page,
      pageSize: pageInfo.size || pageSize,
      hasMore: (pageInfo.number + 1) * pageInfo.size < pageInfo.totalElements,
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw new Error('Ongeldige DSO API-key. Controleer of de key correct is geconfigureerd.');
      }
      if (error.response?.status === 403) {
        throw new Error('Toegang geweigerd. Controleer de API-key rechten.');
      }
      if (error.response?.status === 429) {
        throw new Error('Te veel verzoeken. Probeer het later opnieuw (rate limit).');
      }
      console.error('[DSO Service] API Error:', error.response?.data || error.message);
      throw new Error(`DSO API fout: ${error.response?.status} - ${error.response?.statusText || error.message}`);
    }
    throw error;
  }
}

/**
 * Search for regelingen by geometry (location-based search)
 */
export async function searchRegelingenByLocation(options: {
  geometry: {
    type: 'Point' | 'Polygon';
    coordinates: number[] | number[][];
  };
  typeBevoegdGezag?: string;
  documentType?: string;
  page?: number;
  pageSize?: number;
}): Promise<DsoSearchResult> {
  const {
    geometry,
    typeBevoegdGezag,
    documentType,
    page = 0,
    pageSize = 50,
  } = options;

  try {
    const apiKey = getApiKey();
    
    const params = new URLSearchParams();
    params.set('page', page.toString());
    params.set('size', pageSize.toString());
    
    if (typeBevoegdGezag) {
      const typeMap: Record<string, string> = {
        'gemeente': 'Gemeente',
        'provincie': 'Provincie',
        'waterschap': 'Waterschap',
        'ministerie': 'Ministerie',
      };
      params.set('typeBevoegdGezag', typeMap[typeBevoegdGezag] || typeBevoegdGezag);
    }
    
    if (documentType) {
      params.set('type', documentType);
    }

    const url = `${DSO_BASE_URL}/regelingen/_zoek?${params.toString()}`;
    console.log(`[DSO Service] Geo search: ${url}`);
    
    const response = await axios.post(url, {
      _geo: {
        intersects: geometry,
      },
    }, {
      timeout: 30000,
      headers: {
        'Accept': 'application/hal+json',
        'Content-Type': 'application/json',
        'Content-Crs': 'epsg:28992', // Dutch RD coordinate system
        'X-Api-Key': apiKey,
      },
    });

    const data = response.data;
    const embedded = data._embedded || {};
    const regelingenArray = embedded.regelingen || [];
    const pageInfo = data.page || {};
    
    const regelingen: DsoRegeling[] = regelingenArray.map((item: any) => ({
      identificatie: item.identificatie || '',
      officieleTitel: item.officieleTitel || item.citeertitel || 'Onbekende titel',
      citeerTitel: item.citeertitel,
      type: typeof item.type === 'object' ? (item.type?.waarde || item.type?.code || 'onbekend') : (item.type || 'onbekend'),
      bevoegdGezag: {
        code: item.bevoegdGezag?.code || '',
        naam: item.bevoegdGezag?.naam || 'Onbekend',
      },
      status: item.procedurestatus,
      publicatiedatum: item.gepubliceerdOp,
      inwerkingtreding: item.inwerkingtredingsdatum,
      documentUrl: item._links?.self?.href,
      isSelected: false,
      isUploaded: false,
    }));

    return {
      regelingen,
      totalRecords: pageInfo.totalElements || regelingen.length,
      page: pageInfo.number || page,
      pageSize: pageInfo.size || pageSize,
      hasMore: (pageInfo.number + 1) * pageInfo.size < pageInfo.totalElements,
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error('[DSO Service] Geo API Error:', error.response?.data || error.message);
      throw new Error(`DSO API fout: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Convert identificatie to URL-safe format for DSO API
 * The DSO API expects slashes to be replaced with underscores in the URL path
 * Example: /akn/nl/act/gm0074/2020/omgevingsplan -> _akn_nl_act_gm0074_2020_omgevingsplan
 */
function formatIdentificatieForUrl(identificatie: string): string {
  // Replace all slashes with underscores
  return identificatie.replace(/\//g, '_');
}

/**
 * Get details of a specific regeling
 */
export async function getRegelingDetails(identificatie: string): Promise<any> {
  try {
    const apiKey = getApiKey();
    
    // Convert slashes to underscores for the URL path
    const urlIdentificatie = formatIdentificatieForUrl(identificatie);
    const url = `${DSO_BASE_URL}/regelingen/${urlIdentificatie}`;
    console.log(`[DSO Service] Getting details: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'Accept': 'application/hal+json',
        'X-Api-Key': apiKey,
      },
    });

    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error('[DSO Service] Details Error:', error.response?.data || error.message);
      throw new Error(`DSO API fout: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Download regeling content (ZIP file with text and geometry)
 * Uses the Omgevingsdocument Downloaden API
 */
export async function downloadRegelingContent(identificatie: string): Promise<{
  content: string;
  hash: string;
  metadata: any;
}> {
  try {
    const apiKey = getApiKey();
    
    // Download API endpoint (PRE-PRODUCTIE)
    // Convert slashes to underscores for the URL path
    const urlIdentificatie = formatIdentificatieForUrl(identificatie);
    const downloadUrl = `https://service.pre.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/downloaden/v1/regelingversies/${urlIdentificatie}`;
    console.log(`[DSO Service] Downloading: ${downloadUrl}`);
    
    const response = await axios.get(downloadUrl, {
      timeout: 120000,
      responseType: 'arraybuffer',
      headers: {
        'Accept': 'application/zip',
        'X-Api-Key': apiKey,
      },
    });

    // Calculate hash of content
    const hash = crypto.createHash('sha256').update(response.data).digest('hex');
    
    // For now, return the raw content - parsing would require unzipping
    return {
      content: response.data.toString('base64'),
      hash,
      metadata: {
        identificatie,
        contentLength: response.data.length,
        contentType: response.headers['content-type'],
      },
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error('[DSO Service] Download Error:', error.response?.data || error.message);
      throw new Error(`Download fout: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch list of municipalities from CBS API
 * This provides the complete list with codes for the dropdown
 */
export async function fetchMunicipalities(): Promise<Municipality[]> {
  try {
    // CBS API for municipalities
    // For now, return a static list of major municipalities
    // In production, this would fetch from CBS Gebiedsindelingen API
    const municipalities: Municipality[] = [
      // Grote steden
      { code: 'gm0363', name: 'Amsterdam', province: 'Noord-Holland' },
      { code: 'gm0599', name: 'Rotterdam', province: 'Zuid-Holland' },
      { code: 'gm0518', name: "'s-Gravenhage", province: 'Zuid-Holland' },
      { code: 'gm0344', name: 'Utrecht', province: 'Utrecht' },
      { code: 'gm0772', name: 'Eindhoven', province: 'Noord-Brabant' },
      { code: 'gm0392', name: 'Groningen', province: 'Groningen' },
      { code: 'gm0855', name: 'Tilburg', province: 'Noord-Brabant' },
      { code: 'gm0034', name: 'Almere', province: 'Flevoland' },
      { code: 'gm0758', name: 'Breda', province: 'Noord-Brabant' },
      { code: 'gm0268', name: 'Nijmegen', province: 'Gelderland' },
      { code: 'gm0014', name: 'Groningen', province: 'Groningen' },
      { code: 'gm0193', name: 'Enschede', province: 'Overijssel' },
      { code: 'gm0384', name: 'Haarlem', province: 'Noord-Holland' },
      { code: 'gm0080', name: 'Leeuwarden', province: 'Friesland' },
      { code: 'gm0202', name: 'Arnhem', province: 'Gelderland' },
      { code: 'gm0289', name: 'Zaanstad', province: 'Noord-Holland' },
      { code: 'gm0479', name: 'Amersfoort', province: 'Utrecht' },
      { code: 'gm0453', name: "'s-Hertogenbosch", province: 'Noord-Brabant' },
      { code: 'gm0935', name: 'Apeldoorn', province: 'Gelderland' },
      { code: 'gm0503', name: 'Delft', province: 'Zuid-Holland' },
      { code: 'gm0546', name: 'Leiden', province: 'Zuid-Holland' },
      { code: 'gm0995', name: 'Lelystad', province: 'Flevoland' },
      { code: 'gm0855', name: 'Tilburg', province: 'Noord-Brabant' },
      { code: 'gm0917', name: 'Maastricht', province: 'Limburg' },
      { code: 'gm0274', name: 'Ede', province: 'Gelderland' },
      { code: 'gm0826', name: 'Dordrecht', province: 'Zuid-Holland' },
      { code: 'gm0166', name: 'Haarlemmermeer', province: 'Noord-Holland' },
      { code: 'gm0150', name: 'Deventer', province: 'Overijssel' },
      { code: 'gm0629', name: 'Zoetermeer', province: 'Zuid-Holland' },
      { code: 'gm0164', name: 'Hilversum', province: 'Noord-Holland' },
    ].sort((a, b) => a.name.localeCompare(b.name, 'nl'));

    return municipalities;
  } catch (error) {
    console.error('[DSO Service] Failed to fetch municipalities:', error);
    return [];
  }
}

/**
 * Fetch list of provinces
 */
export function getProvinces(): Array<{ code: string; name: string }> {
  return [
    { code: 'pv20', name: 'Groningen' },
    { code: 'pv21', name: 'Friesland' },
    { code: 'pv22', name: 'Drenthe' },
    { code: 'pv23', name: 'Overijssel' },
    { code: 'pv24', name: 'Flevoland' },
    { code: 'pv25', name: 'Gelderland' },
    { code: 'pv26', name: 'Utrecht' },
    { code: 'pv27', name: 'Noord-Holland' },
    { code: 'pv28', name: 'Zuid-Holland' },
    { code: 'pv29', name: 'Zeeland' },
    { code: 'pv30', name: 'Noord-Brabant' },
    { code: 'pv31', name: 'Limburg' },
  ];
}

// ============================================================================
// DSO REGELING CHUNKING - For Pinecone Upload
// ============================================================================

export interface DsoRegelingChunk {
  id: string;
  text: string;
  regeling_id: string;
  regeling_title: string;
  type: string;
  bevoegd_gezag: string;
  bevoegd_gezag_type: string;
  source: 'omgevingswet';
  source_url: string;
  article_number?: string;
  seq_in_article: number;
  structure_path?: string;
  version_date?: string;
  is_current_version: boolean;
  chunkIndex: number;
}

/**
 * Determine the type of bevoegd gezag (authority type) from the identificatie
 * Format: /akn/nl/act/{authority_code}/{year}/{type}
 * Authority codes: gm = gemeente, pv = provincie, ws = waterschap, mn = ministerie
 */
export function determineBevoegdGezagType(identificatie: string): string {
  // Extract authority code from identificatie
  // Example: /akn/nl/act/gm0047/2020/omgevingsplan -> gm
  const match = identificatie.match(/\/akn\/nl\/act\/([a-z]+)\d+\//i);
  if (match) {
    const prefix = match[1].toLowerCase();
    switch (prefix) {
      case 'gm': return 'gemeente';
      case 'pv': return 'provincie';
      case 'ws': return 'waterschap';
      case 'mn': return 'ministerie';
      case 'mnre': return 'ministerie';
      default: return 'onbekend';
    }
  }
  return 'onbekend';
}

/**
 * Generate source URL for a regeling
 * Returns the URL to view this document in the DSO viewer
 */
export function generateSourceUrl(identificatie: string): string {
  // DSO viewer URL format - uses the identificatie with underscores
  const urlIdentificatie = formatIdentificatieForUrl(identificatie);
  return `https://omgevingswet.overheid.nl/regels-op-de-kaart/viewer/regeling/${urlIdentificatie}`;
}

/**
 * Get the text content of a regeling from the DSO Presenteren API
 * Uses the /regelingen/{identificatie}/tekst endpoint for full text
 */
export async function getRegelingTextContent(identificatie: string): Promise<{
  content: string;
  hash: string;
  metadata: any;
}> {
  try {
    const apiKey = getApiKey();
    const urlIdentificatie = formatIdentificatieForUrl(identificatie);
    
    // First get metadata from the main regeling endpoint
    const metaUrl = `${DSO_BASE_URL}/regelingen/${urlIdentificatie}`;
    console.log(`[DSO Service] Getting metadata: ${metaUrl}`);
    
    const metaResponse = await axios.get(metaUrl, {
      timeout: 60000,
      headers: {
        'Accept': 'application/hal+json',
        'X-Api-Key': apiKey,
      },
    });
    const metaData = metaResponse.data;
    
    // Get the full text content from the /tekststructuur endpoint
    let textContent = '';
    
    // First try the tekststructuur link from the metadata response
    if (metaData._links?.tekststructuur?.href) {
      try {
        console.log(`[DSO Service] Getting tekststructuur: ${metaData._links.tekststructuur.href}`);
        const tekstResponse = await axios.get(metaData._links.tekststructuur.href, {
          timeout: 120000,
          headers: {
            'Accept': 'application/hal+json',
            'X-Api-Key': apiKey,
          },
        });
        
        const tekstData = tekstResponse.data;
        textContent = extractTextFromTekststructuur(tekstData);
        console.log(`[DSO Service] Tekststructuur extracted ${textContent.length} chars`);
      } catch (tekstError: any) {
        console.log(`[DSO Service] tekststructuur failed (${tekstError.response?.status}), trying alternatives...`);
      }
    }
    
    // Fallback to documentstructuur if tekststructuur failed
    if (!textContent.trim() || textContent.length < 100) {
      if (metaData._links?.documentstructuur?.href) {
        console.log(`[DSO Service] Trying documentstructuur...`);
        textContent = await fetchDocumentStructure(metaData._links.documentstructuur.href, apiKey);
        console.log(`[DSO Service] Documentstructuur extracted ${textContent.length} chars`);
      }
    }
    
    // Final fallback: use metadata
    if (!textContent.trim() || textContent.length < 100) {
      console.log(`[DSO Service] Using metadata fallback for ${identificatie}`);
      textContent = `${metaData.officieleTitel || ''}\n\n${metaData.citeertitel || ''}\n\n${metaData.omschrijving || ''}`;
    }
    
    console.log(`[DSO Service] Final content length for ${identificatie}: ${textContent.length} chars`);
    
    const hash = crypto.createHash('sha256').update(textContent).digest('hex');
    
    return {
      content: textContent,
      hash,
      metadata: {
        identificatie,
        officieleTitel: metaData.officieleTitel,
        citeertitel: metaData.citeertitel,
        type: typeof metaData.type === 'object' ? (metaData.type?.waarde || metaData.type?.code) : metaData.type,
        bevoegdGezag: metaData.bevoegdGezag,
        contentLength: textContent.length,
      },
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error('[DSO Service] Text content error:', error.response?.data || error.message);
      throw new Error(`Fout bij ophalen tekst ${identificatie}: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch document structure and extract text content
 */
async function fetchDocumentStructure(url: string, apiKey: string): Promise<string> {
  try {
    const response = await axios.get(url, {
      timeout: 60000,
      headers: {
        'Accept': 'application/hal+json',
        'X-Api-Key': apiKey,
      },
    });
    
    const data = response.data;
    return extractTextFromStructure(data);
  } catch (error) {
    console.error('[DSO Service] Document structure fetch error:', error);
    return '';
  }
}

/**
 * Extract text from DSO tekststructuur response
 * The response has nested tekststructuurDocumentComponenten with inhoud fields containing XML text
 */
function extractTextFromTekststructuur(data: any): string {
  if (!data) return '';
  
  const parts: string[] = [];
  
  function processComponent(component: any, depth: number = 0): void {
    if (!component) return;
    
    // Build section header from label, nummer, and opschrift
    const headerParts: string[] = [];
    if (component.label) {
      headerParts.push(extractTextFromHtml(component.label));
    }
    if (component.nummer) {
      headerParts.push(extractTextFromHtml(component.nummer));
    }
    if (component.opschrift) {
      const opschriftText = extractTextFromHtml(component.opschrift);
      if (opschriftText) headerParts.push(opschriftText);
    }
    
    if (headerParts.length > 0) {
      const prefix = '#'.repeat(Math.min(depth + 1, 4));
      parts.push(`${prefix} ${headerParts.join(' ')}`);
    }
    
    // Extract content from inhoud field (contains XML text)
    if (component.inhoud) {
      const inhoudText = extractTextFromHtml(component.inhoud);
      if (inhoudText.trim()) {
        parts.push(inhoudText);
      }
    }
    
    // Recursively process nested components
    if (component._embedded?.tekststructuurDocumentComponenten) {
      for (const child of component._embedded.tekststructuurDocumentComponenten) {
        processComponent(child, depth + 1);
      }
    }
  }
  
  // Start processing from the root embedded components
  if (data._embedded?.tekststructuurDocumentComponenten) {
    for (const component of data._embedded.tekststructuurDocumentComponenten) {
      processComponent(component, 0);
    }
  }
  
  return parts.filter(p => p.trim()).join('\n\n');
}

/**
 * Extract text from document structure response
 */
function extractTextFromStructure(structure: any): string {
  if (!structure) return '';
  
  const parts: string[] = [];
  
  // Handle embedded items
  if (structure._embedded) {
    const items = structure._embedded.items || structure._embedded.artikelen || 
                  structure._embedded.divisies || structure._embedded.inhoud || [];
    
    if (Array.isArray(items)) {
      for (const item of items) {
        const itemText = extractTextFromStructureItem(item);
        if (itemText) parts.push(itemText);
      }
    }
  }
  
  // Handle direct text content
  if (structure.tekst) {
    parts.push(extractTextValue(structure.tekst));
  }
  if (structure.inhoud) {
    parts.push(extractTextValue(structure.inhoud));
  }
  
  return parts.filter(p => p.trim()).join('\n\n');
}

/**
 * Extract text from a structure item (article, division, etc.)
 */
function extractTextFromStructureItem(item: any): string {
  if (!item) return '';
  
  const parts: string[] = [];
  
  // Get title/label
  if (item.label) parts.push(`## ${item.label}`);
  if (item.titel) parts.push(`## ${item.titel}`);
  if (item.nummer) parts.push(`Artikel ${item.nummer}`);
  
  // Get content
  if (item.tekst) parts.push(extractTextValue(item.tekst));
  if (item.inhoud) parts.push(extractTextValue(item.inhoud));
  
  // Recursively handle nested items
  if (item._embedded) {
    const nestedText = extractTextFromStructure(item);
    if (nestedText) parts.push(nestedText);
  }
  
  return parts.filter(p => p.trim()).join('\n');
}

/**
 * Extract text value from various formats
 */
function extractTextValue(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') {
    return extractTextFromHtml(value);
  }
  if (value._text) return extractTextFromHtml(value._text);
  if (value['#text']) return extractTextFromHtml(value['#text']);
  if (Array.isArray(value)) {
    return value.map(v => extractTextValue(v)).join('\n');
  }
  return '';
}

/**
 * Extract plain text from HTML content
 */
function extractTextFromHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract text from embedded content array
 */
function extractTextFromEmbedded(embedded: any): string {
  if (!embedded) return '';
  if (typeof embedded === 'string') return embedded;
  if (Array.isArray(embedded)) {
    return embedded.map(item => extractTextFromEmbedded(item)).join('\n\n');
  }
  if (embedded.tekst) return extractTextValue(embedded.tekst);
  if (embedded.inhoud) return extractTextValue(embedded.inhoud);
  return '';
}

/**
 * Parse DSO regeling text into chunks for Pinecone
 */
export function parseDsoRegelingToChunks(
  textContent: string,
  regelingId: string,
  title: string,
  type: string,
  bevoegdGezag: string,
  bevoegdGezagType: string,
  versionDate?: string,
  isCurrentVersion: boolean = true
): DsoRegelingChunk[] {
  const chunks: DsoRegelingChunk[] = [];
  
  if (!textContent || !textContent.trim()) {
    console.warn(`[DSO Service] No content to chunk for ${regelingId}`);
    return chunks;
  }
  
  // Split content into logical sections
  const sections = splitIntoSections(textContent);
  let chunkIndex = 0;
  
  for (const section of sections) {
    const { title: sectionTitle, content: sectionContent, path: structurePath } = section;
    
    if (!sectionContent.trim()) continue;
    
    // Check if section is small enough for one chunk (< 500 words)
    const wordCount = sectionContent.split(/\s+/).length;
    
    if (wordCount <= 500) {
      chunks.push(createDsoChunk({
        regelingId,
        title,
        type,
        bevoegdGezag,
        bevoegdGezagType,
        sectionTitle,
        sectionContent,
        structurePath,
        versionDate,
        isCurrentVersion,
        chunkIndex,
        seqInArticle: 0,
      }));
      chunkIndex++;
    } else {
      // Split into smaller chunks
      const subChunks = splitTextBySize(sectionContent, 400, 50);
      
      for (let i = 0; i < subChunks.length; i++) {
        chunks.push(createDsoChunk({
          regelingId,
          title,
          type,
          bevoegdGezag,
          bevoegdGezagType,
          sectionTitle: sectionTitle ? `${sectionTitle} (deel ${i + 1})` : undefined,
          sectionContent: subChunks[i],
          structurePath,
          versionDate,
          isCurrentVersion,
          chunkIndex,
          seqInArticle: i,
        }));
        chunkIndex++;
      }
    }
  }
  
  console.log(`[DSO Service] Created ${chunks.length} chunks for ${regelingId}`);
  return chunks;
}

/**
 * Create a DSO chunk object
 */
function createDsoChunk(options: {
  regelingId: string;
  title: string;
  type: string;
  bevoegdGezag: string;
  bevoegdGezagType: string;
  sectionTitle?: string;
  sectionContent: string;
  structurePath?: string;
  versionDate?: string;
  isCurrentVersion: boolean;
  chunkIndex: number;
  seqInArticle: number;
}): DsoRegelingChunk {
  const {
    regelingId, title, type, bevoegdGezag, bevoegdGezagType,
    sectionTitle, sectionContent, structurePath, versionDate,
    isCurrentVersion, chunkIndex, seqInArticle
  } = options;
  
  const formattedText = formatDsoChunkText(
    title, type, bevoegdGezag, sectionTitle, sectionContent, structurePath
  );
  
  // Generate source URL for this regeling
  const sourceUrl = generateSourceUrl(regelingId);
  
  return {
    id: `${regelingId}#${chunkIndex}#${seqInArticle}#${versionDate || 'current'}`,
    text: formattedText,
    regeling_id: regelingId,
    regeling_title: title,
    type,
    bevoegd_gezag: bevoegdGezag,
    bevoegd_gezag_type: bevoegdGezagType,
    source: 'omgevingswet',
    source_url: sourceUrl,
    article_number: sectionTitle,
    seq_in_article: seqInArticle,
    structure_path: structurePath,
    version_date: versionDate,
    is_current_version: isCurrentVersion,
    chunkIndex,
  };
}

/**
 * Format chunk text for embedding - includes context
 */
function formatDsoChunkText(
  title: string,
  type: string,
  bevoegdGezag: string,
  sectionTitle: string | undefined,
  content: string,
  structurePath: string | undefined
): string {
  const parts: string[] = [];
  
  // Add context header
  parts.push(`[OMGEVINGSWET DOCUMENT]`);
  parts.push(`Type: ${type}`);
  parts.push(`Bevoegd gezag: ${bevoegdGezag}`);
  parts.push(`Titel: ${title}`);
  
  if (structurePath) {
    parts.push(`Locatie: ${structurePath}`);
  }
  
  if (sectionTitle) {
    parts.push(`\n## ${sectionTitle}`);
  }
  
  parts.push(`\n${content}`);
  
  return parts.join('\n');
}

/**
 * Split text content into logical sections based on headers and structure
 */
function splitIntoSections(text: string): Array<{ title?: string; content: string; path?: string }> {
  const sections: Array<{ title?: string; content: string; path?: string }> = [];
  
  // Split by common section markers
  const sectionRegex = /(?:^|\n)((?:#{1,3}|Artikel|Hoofdstuk|Afdeling|Paragraaf|Titel)\s+[\d.]*[^\n]*)/gi;
  
  const parts = text.split(sectionRegex);
  
  if (parts.length <= 1) {
    // No clear sections found, treat as one section
    sections.push({ content: text.trim() });
    return sections;
  }
  
  let currentTitle: string | undefined;
  let currentContent: string[] = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    
    // Check if this is a section header
    if (/^(#{1,3}|Artikel|Hoofdstuk|Afdeling|Paragraaf|Titel)\s/i.test(part)) {
      // Save previous section if exists
      if (currentContent.length > 0) {
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n').trim(),
        });
        currentContent = [];
      }
      currentTitle = part.replace(/^#+\s*/, '');
    } else {
      currentContent.push(part);
    }
  }
  
  // Add last section
  if (currentContent.length > 0) {
    sections.push({
      title: currentTitle,
      content: currentContent.join('\n').trim(),
    });
  }
  
  // If no sections were created with titles, create one big section
  if (sections.length === 0) {
    sections.push({ content: text.trim() });
  }
  
  return sections;
}

/**
 * Split text into chunks of specified size with overlap
 */
function splitTextBySize(text: string, targetWords: number = 400, overlapWords: number = 50): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 0) return [];
  if (words.length <= targetWords) return [text.trim()];
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < words.length) {
    const end = Math.min(start + targetWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
    
    if (end >= words.length) break;
    
    start += targetWords - overlapWords;
    if (start >= words.length) break;
  }
  
  return chunks;
}
