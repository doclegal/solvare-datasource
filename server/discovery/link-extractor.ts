import * as cheerio from 'cheerio';

export interface ExtractedLink {
  url: string;
  text: string;
}

/**
 * Extract and normalize all links from HTML content
 * @param html Raw HTML content
 * @param baseUrl Base URL for resolving relative links
 * @param rootUrl Root URL to filter links by domain and path prefix
 * @returns Array of normalized URLs that match the same domain and path prefix
 */
export function extractLinks(
  html: string,
  baseUrl: string,
  rootUrl: string
): string[] {
  try {
    const $ = cheerio.load(html);
    const links: string[] = [];
    const seen = new Set<string>();
    
    // Parse root URL to get domain and path prefix
    const rootParsed = new URL(rootUrl);
    const rootPathPrefix = rootParsed.pathname.replace(/\/+$/, ''); // Remove trailing slashes
    
    // Extract all anchor tags
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      
      try {
        // Normalize the URL (resolve relative URLs)
        const normalized = new URL(href, baseUrl);
        
        // Filter criteria:
        // 1. Same origin (protocol + domain + port)
        // 2. Path starts with root path prefix
        // 3. HTTP or HTTPS only (no mailto:, javascript:, etc.)
        if (
          normalized.origin === rootParsed.origin &&
          normalized.pathname.startsWith(rootPathPrefix) &&
          (normalized.protocol === 'http:' || normalized.protocol === 'https:')
        ) {
          // Remove fragment identifier and normalize
          normalized.hash = '';
          const cleanUrl = normalized.href;
          
          // Deduplicate
          if (!seen.has(cleanUrl)) {
            seen.add(cleanUrl);
            links.push(cleanUrl);
          }
        }
      } catch (error) {
        // Skip invalid URLs
        console.log(`Skipping invalid link: ${href}`);
      }
    });
    
    return links;
  } catch (error) {
    console.error('Error extracting links:', error);
    return [];
  }
}

/**
 * Extract detailed link information (URL + anchor text)
 */
export function extractLinksWithText(
  html: string,
  baseUrl: string
): ExtractedLink[] {
  try {
    const $ = cheerio.load(html);
    const links: ExtractedLink[] = [];
    
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      
      if (href) {
        try {
          const normalized = new URL(href, baseUrl);
          links.push({
            url: normalized.href,
            text: text || normalized.href,
          });
        } catch {
          // Skip invalid URLs
        }
      }
    });
    
    return links;
  } catch (error) {
    console.error('Error extracting links with text:', error);
    return [];
  }
}
