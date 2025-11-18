import axios from 'axios';

const GOOGLE_API_KEY = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
const SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface GoogleSearchResponse {
  items?: GoogleSearchResult[];
  searchInformation?: {
    totalResults: string;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

/**
 * Search the web using Google Custom Search API
 * Free tier: 100 queries/day
 */
export async function searchWeb(
  query: string,
  options: {
    start?: number;
    num?: number; // Max 10 per request
    siteSearch?: string; // Optional domain restriction (e.g., "recht.nl")
  } = {}
): Promise<SearchResult[]> {
  if (!GOOGLE_API_KEY || !SEARCH_ENGINE_ID) {
    throw new Error('Google Custom Search API credentials not configured');
  }

  const { start = 0, num = 10, siteSearch } = options;

  const params: Record<string, any> = {
    key: GOOGLE_API_KEY,
    cx: SEARCH_ENGINE_ID,
    q: query,
    start: start + 1, // Google uses 1-indexed
    num: Math.min(num, 10), // Max 10 results per request
  };

  if (siteSearch) {
    params.siteSearch = siteSearch;
  }

  try {
    const response = await axios.get<GoogleSearchResponse>(
      'https://www.googleapis.com/customsearch/v1',
      { params }
    );

    if (!response.data.items) {
      return [];
    }

    return response.data.items.map(item => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      domain: item.displayLink,
    }));
  } catch (error: any) {
    console.error('[Google Search] Error:', error.response?.data || error.message);
    throw new Error(`Google Search failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Extract ECLI codes from text using regex
 * Pattern: ECLI:NL:[A-Z0-9]+:[0-9]{4}:[A-Z0-9.\-]+
 */
export function extractECLIs(text: string): string[] {
  const ecliPattern = /ECLI:NL:[A-Z0-9]+:[0-9]{4}:[A-Z0-9.\-]+/gi;
  const matches = text.match(ecliPattern) || [];
  
  // Normalize to uppercase and deduplicate
  const normalized = matches.map(ecli => ecli.toUpperCase());
  return [...new Set(normalized)];
}
