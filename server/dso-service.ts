/**
 * DSO Service - Fetches Dutch environmental plans (Omgevingsplannen) from DSO-LV
 * 
 * Uses the Omgevingsdocument Presenteren API v8 to query omgevingsplannen.
 * DSO = Digitaal Stelsel Omgevingswet
 * 
 * Endpoints:
 * - Base: https://service.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v8
 * - Search regelingen: /regelingen
 * - Search by location: /regelingen/_zoek
 * 
 * Authentication: API key required (X-Api-Key header)
 */

import axios from 'axios';
import crypto from 'crypto';

const DSO_BASE_URL = 'https://service.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v8';

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
    
    // Build query parameters
    const params = new URLSearchParams();
    params.set('page', page.toString());
    params.set('size', pageSize.toString());
    
    // Add filters
    if (bevoegdGezag) {
      params.set('bevoegdGezag', bevoegdGezag);
    }
    
    if (typeBevoegdGezag) {
      // Convert to DSO format: Gemeente, Provincie, Waterschap, Ministerie
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
    
    // Time travel parameters - defaults to today if not specified
    if (geldigOp) {
      params.set('geldigOp', geldigOp);
    }
    if (inWerkingOp) {
      params.set('inWerkingOp', inWerkingOp);
    }

    const url = `${DSO_BASE_URL}/regelingen?${params.toString()}`;
    console.log(`[DSO Service] Searching: ${url}`);
    
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
      type: item.type || 'onbekend',
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
      type: item.type || 'onbekend',
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
 * Get details of a specific regeling
 */
export async function getRegelingDetails(identificatie: string): Promise<any> {
  try {
    const apiKey = getApiKey();
    
    const url = `${DSO_BASE_URL}/regelingen/${encodeURIComponent(identificatie)}`;
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
    
    // Download API endpoint
    const downloadUrl = `https://service.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/downloaden/v1/regelingversies/${encodeURIComponent(identificatie)}`;
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
