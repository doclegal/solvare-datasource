import axios from 'axios';
import { extractECLIs } from './serper-search';

/**
 * Detect if input is a full URL or just a domain
 */
export function isFullUrl(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://');
}

/**
 * Generate paginated URLs for a base URL
 * Supports patterns like:
 * - /page/2/, /page/3/, etc.
 * - ?page=2, ?page=3, etc.
 */
export function generatePaginatedUrls(baseUrl: string, maxPages: number = 10): string[] {
  const urls: string[] = [baseUrl]; // Start with base URL
  
  // Normalize URL to ensure trailing slash if it ends with a directory pattern
  let normalizedBase = baseUrl;
  if (!normalizedBase.includes('?') && !normalizedBase.match(/\.[a-z]{2,5}$/i)) {
    // It's a directory URL, ensure trailing slash
    if (!normalizedBase.endsWith('/')) {
      normalizedBase += '/';
    }
  }
  
  // Generate /page/N/ style URLs
  for (let page = 2; page <= maxPages; page++) {
    if (normalizedBase.endsWith('/')) {
      urls.push(`${normalizedBase}page/${page}/`);
    } else {
      // Try query parameter style if URL has query params already
      const urlObj = new URL(normalizedBase);
      urlObj.searchParams.set('page', page.toString());
      urls.push(urlObj.toString());
    }
  }
  
  return urls;
}

/**
 * Crawl a single URL and extract ECLIs from its content
 */
export async function crawlUrl(url: string): Promise<string[]> {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RechtspraakBot/1.0)',
      },
      maxRedirects: 3,
    });
    
    if (response.status !== 200) {
      console.log(`[URL Crawler] Non-200 status for ${url}: ${response.status}`);
      return [];
    }
    
    const eclis = extractECLIs(response.data);
    return eclis;
  } catch (error: any) {
    // Log but don't throw - some pages may fail
    console.log(`[URL Crawler] Failed to fetch ${url}:`, error.message);
    return [];
  }
}

export interface CrawlProgress {
  type: 'url_start' | 'url_complete' | 'page_crawled' | 'ecli_found';
  message: string;
  url?: string;
  page?: number;
  eclisFound?: number;
  totalEclis?: number;
}

/**
 * Crawl a URL with automatic pagination
 * Stops when:
 * - Max pages reached
 * - 2 consecutive pages with no NEW ECLIs (allows skipping empty pages)
 * - HTTP errors on consecutive pages
 */
export async function crawlUrlWithPagination(
  url: string,
  options: {
    maxPages?: number;
    onProgress?: (progress: CrawlProgress) => Promise<void>;
  } = {}
): Promise<{ eclis: string[]; ecliToUrlMap: Map<string, string> }> {
  const { maxPages = 10, onProgress } = options;
  
  const allEclis = new Set<string>();
  const ecliToUrlMap = new Map<string, string>(); // Track which URL each ECLI came from
  let consecutiveEmptyPages = 0;
  
  if (onProgress) {
    await onProgress({
      type: 'url_start',
      message: `Start crawling: ${url}`,
      url,
    });
  }
  
  // Generate paginated URLs
  const paginatedUrls = generatePaginatedUrls(url, maxPages);
  
  // Crawl each page
  for (let i = 0; i < paginatedUrls.length; i++) {
    const pageUrl = paginatedUrls[i];
    const pageNumber = i + 1;
    
    if (onProgress) {
      await onProgress({
        type: 'page_crawled',
        message: `Scannen pagina ${pageNumber}/${maxPages}...`,
        url: pageUrl,
        page: pageNumber,
      });
    }
    
    const eclis = await crawlUrl(pageUrl);
    
    // Check if we found any NEW ECLIs on this page
    const previousCount = allEclis.size;
    eclis.forEach(ecli => {
      if (!allEclis.has(ecli)) {
        allEclis.add(ecli);
        ecliToUrlMap.set(ecli, pageUrl); // Track source URL for this ECLI
      }
    });
    const newEclisCount = allEclis.size - previousCount;
    
    // Track consecutive empty pages (no NEW ECLIs)
    if (newEclisCount === 0) {
      consecutiveEmptyPages++;
    } else {
      consecutiveEmptyPages = 0; // Reset counter when we find new ECLIs
    }
    
    if (onProgress && newEclisCount > 0) {
      await onProgress({
        type: 'ecli_found',
        message: `${newEclisCount} nieuwe ECLI's gevonden op pagina ${pageNumber}`,
        eclisFound: newEclisCount,
        totalEclis: allEclis.size,
      });
    }
    
    // Stop if 2 consecutive pages yielded no NEW ECLIs (likely end of pagination)
    if (consecutiveEmptyPages >= 2 && i > 0) {
      if (onProgress) {
        await onProgress({
          type: 'url_complete',
          message: `Paginering gestopt: geen nieuwe ECLI's na 2 pagina's`,
          totalEclis: allEclis.size,
        });
      }
      break;
    }
    
    // Rate limiting between pages
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  if (onProgress) {
    await onProgress({
      type: 'url_complete',
      message: `Crawling voltooid: ${allEclis.size} unieke ECLI's gevonden`,
      totalEclis: allEclis.size,
    });
  }
  
  return {
    eclis: Array.from(allEclis),
    ecliToUrlMap,
  };
}
