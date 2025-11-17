import { crawlUrl, type CrawlResult } from './crawler';
import { extractLinks } from './link-extractor';
import { extractECLIs } from './extractor';

export interface CrawlConfig {
  maxDepth: number;
  maxPages: number;
  delayMs: number;
}

export interface CrawlQueueItem {
  url: string;
  depth: number;
}

export interface SectionCrawlProgress {
  type: 'section_crawl_start' | 'section_crawl_page' | 'section_crawl_complete' | 'section_crawl_error';
  sectionRoot: string;
  currentUrl?: string;
  currentDepth?: number;
  queueSize?: number;
  processedPages?: number;
  totalPages?: number;
  message: string;
  eclisFound?: number;
}

export interface SectionCrawlResult {
  sectionRoot: string;
  pagesVisited: number;
  eclisFound: Map<string, Set<string>>; // ECLI -> Set of source URLs
  errors: string[];
}

const DEFAULT_CONFIG: CrawlConfig = {
  maxDepth: 3,
  maxPages: 75,
  delayMs: 1000, // 1 second between requests to same host
};

/**
 * Crawl a section (all pages under a root URL) using breadth-first search
 * @param rootUrl Starting URL (section root)
 * @param config Crawl configuration (depth, page limits, delays)
 * @param onProgress Progress callback for SSE updates
 * @returns Map of ECLI -> source URLs found in this section
 */
export async function crawlSection(
  rootUrl: string,
  config: Partial<CrawlConfig> = {},
  onProgress?: (progress: SectionCrawlProgress) => void | Promise<void>
): Promise<SectionCrawlResult> {
  const finalConfig: CrawlConfig = { ...DEFAULT_CONFIG, ...config };
  
  const visited = new Set<string>();
  const queue: CrawlQueueItem[] = [{ url: rootUrl, depth: 0 }];
  const eclisFound = new Map<string, Set<string>>(); // ECLI -> Set of URLs where found
  const errors: string[] = [];
  
  await onProgress?.({
    type: 'section_crawl_start',
    sectionRoot: rootUrl,
    queueSize: 1,
    processedPages: 0,
    totalPages: 0,
    message: `Starting section crawl: ${rootUrl}`,
  });
  
  // Track last request time per host for rate limiting
  const lastRequestByHost = new Map<string, number>();
  
  while (queue.length > 0 && visited.size < finalConfig.maxPages) {
    const current = queue.shift()!;
    
    // Skip if already visited
    if (visited.has(current.url)) {
      continue;
    }
    
    // Skip if depth exceeded
    if (current.depth > finalConfig.maxDepth) {
      continue;
    }
    
    // Mark as visited
    visited.add(current.url);
    
    await onProgress?.({
      type: 'section_crawl_page',
      sectionRoot: rootUrl,
      currentUrl: current.url,
      currentDepth: current.depth,
      queueSize: queue.length,
      processedPages: visited.size,
      message: `Crawling (depth ${current.depth}): ${current.url}`,
    });
    
    // Rate limiting per host
    try {
      const urlObj = new URL(current.url);
      const host = urlObj.host;
      const lastRequest = lastRequestByHost.get(host) || 0;
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequest;
      
      if (timeSinceLastRequest < finalConfig.delayMs) {
        const waitTime = finalConfig.delayMs - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      lastRequestByHost.set(host, Date.now());
    } catch (error) {
      console.error(`Invalid URL: ${current.url}`, error);
      errors.push(`Invalid URL: ${current.url}`);
      continue;
    }
    
    // Fetch the page
    let crawlResult: CrawlResult;
    try {
      crawlResult = await crawlUrl(current.url);
    } catch (error: any) {
      const errorMsg = `Failed to crawl ${current.url}: ${error.message}`;
      errors.push(errorMsg);
      await onProgress?.({
        type: 'section_crawl_error',
        sectionRoot: rootUrl,
        currentUrl: current.url,
        message: `✗ ${errorMsg}`,
      });
      continue;
    }
    
    // Skip if robots.txt blocked or fetch failed
    if (!crawlResult.robotsAllowed) {
      errors.push(`Skipped ${current.url}: Blocked by robots.txt`);
      continue;
    }
    
    if (!crawlResult.html) {
      const reason = crawlResult.error || 'Unknown error';
      errors.push(`Skipped ${current.url}: ${reason}`);
      continue;
    }
    
    // Extract ECLIs from this page
    const foundEclis = extractECLIs(crawlResult.html, current.url);
    
    if (foundEclis.length > 0) {
      foundEclis.forEach(extracted => {
        if (!eclisFound.has(extracted.ecli)) {
          eclisFound.set(extracted.ecli, new Set());
        }
        eclisFound.get(extracted.ecli)!.add(current.url);
      });
      
      await onProgress?.({
        type: 'section_crawl_page',
        sectionRoot: rootUrl,
        currentUrl: current.url,
        eclisFound: foundEclis.length,
        message: `✓ Found ${foundEclis.length} ECLI(s) on ${current.url}`,
      });
    }
    
    // Extract and queue child links (only if not at max depth)
    if (current.depth < finalConfig.maxDepth) {
      const childLinks = extractLinks(crawlResult.html, current.url, rootUrl);
      
      // Filter out already visited and already queued URLs
      const queuedUrls = new Set(queue.map(item => item.url));
      const newLinks = childLinks.filter(
        link => !visited.has(link) && !queuedUrls.has(link)
      );
      
      // Add to queue
      newLinks.forEach(link => {
        queue.push({ url: link, depth: current.depth + 1 });
      });
      
      if (newLinks.length > 0) {
        await onProgress?.({
          type: 'section_crawl_page',
          sectionRoot: rootUrl,
          queueSize: queue.length,
          message: `  → Queued ${newLinks.length} new link(s) from ${current.url}`,
        });
      }
    }
  }
  
  // Completion
  const totalEclis = Array.from(eclisFound.keys()).length;
  
  await onProgress?.({
    type: 'section_crawl_complete',
    sectionRoot: rootUrl,
    processedPages: visited.size,
    totalPages: visited.size,
    queueSize: 0,
    eclisFound: totalEclis,
    message: `✓ Section crawl complete: ${visited.size} pages visited, ${totalEclis} unique ECLIs found`,
  });
  
  return {
    sectionRoot: rootUrl,
    pagesVisited: visited.size,
    eclisFound,
    errors,
  };
}
