/**
 * Web Crawler Module
 * Fetches HTML from URLs with rate limiting and robots.txt respect
 */

import axios from 'axios';
import RobotsParser from 'robots-parser';

interface CrawlResult {
  url: string;
  html: string | null;
  error: string | null;
  robotsAllowed: boolean;
}

type RobotsParserInstance = ReturnType<typeof RobotsParser>;

interface RobotsCacheEntry {
  parser: RobotsParserInstance;
  fetchedAt: number;
}

// Cache robots.txt per host for 1 hour
const robotsCache = new Map<string, RobotsCacheEntry>();
const ROBOTS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Rate limiting: track last request time per host
const hostLastRequestTime = new Map<string, number>();
const MIN_DELAY_MS = 1000; // 1 second between requests to same host

/**
 * Get hostname from URL
 */
function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

/**
 * Fetch and parse robots.txt for a host
 */
async function getRobotsParser(hostname: string): Promise<RobotsParserInstance> {
  const cached = robotsCache.get(hostname);
  const now = Date.now();
  
  // Return cached if still valid
  if (cached && (now - cached.fetchedAt < ROBOTS_CACHE_TTL)) {
    return cached.parser;
  }
  
  // Fetch robots.txt
  const robotsUrl = `https://${hostname}/robots.txt`;
  let robotsTxt = '';
  
  try {
    const response = await axios.get(robotsUrl, {
      timeout: 5000,
      validateStatus: (status) => status === 200 || status === 404,
    });
    
    if (response.status === 200) {
      robotsTxt = response.data;
    }
  } catch (error) {
    console.log(`[Crawler] Could not fetch robots.txt for ${hostname}, allowing by default`);
  }
  
  // Parse robots.txt
  const parser = RobotsParser(robotsUrl, robotsTxt);
  
  // Cache it
  robotsCache.set(hostname, {
    parser,
    fetchedAt: now,
  });
  
  return parser;
}

/**
 * Check if URL is allowed by robots.txt
 */
async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const hostname = getHostname(url);
    const parser = await getRobotsParser(hostname);
    
    // Check if our user agent is allowed
    const userAgent = 'RechtspraakBot/1.0';
    return parser.isAllowed(url, userAgent) ?? true;
  } catch (error) {
    console.error(`[Crawler] Error checking robots.txt: ${error}`);
    return true; // Allow by default on error
  }
}

/**
 * Apply rate limiting for host
 */
async function applyRateLimit(hostname: string): Promise<void> {
  const lastRequest = hostLastRequestTime.get(hostname);
  const now = Date.now();
  
  if (lastRequest) {
    const timeSinceLastRequest = now - lastRequest;
    if (timeSinceLastRequest < MIN_DELAY_MS) {
      const delay = MIN_DELAY_MS - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  hostLastRequestTime.set(hostname, Date.now());
}

/**
 * Crawl a single URL and return HTML
 */
export async function crawlUrl(url: string): Promise<CrawlResult> {
  try {
    const hostname = getHostname(url);
    
    // Check robots.txt
    const robotsAllowed = await isAllowedByRobots(url);
    if (!robotsAllowed) {
      return {
        url,
        html: null,
        error: 'Blocked by robots.txt',
        robotsAllowed: false,
      };
    }
    
    // Apply rate limiting
    await applyRateLimit(hostname);
    
    // Fetch HTML
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'RechtspraakBot/1.0',
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });
    
    return {
      url,
      html: response.data,
      error: null,
      robotsAllowed: true,
    };
  } catch (error: any) {
    return {
      url,
      html: null,
      error: error.message || 'Unknown error',
      robotsAllowed: true,
    };
  }
}

/**
 * Crawl multiple URLs with concurrency control
 */
export async function crawlUrls(
  urls: string[],
  onProgress?: (url: string, result: CrawlResult) => void
): Promise<CrawlResult[]> {
  const results: CrawlResult[] = [];
  
  // Process one at a time to respect rate limits
  for (const url of urls) {
    const result = await crawlUrl(url);
    results.push(result);
    
    if (onProgress) {
      onProgress(url, result);
    }
  }
  
  return results;
}
