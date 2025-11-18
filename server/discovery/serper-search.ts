import axios from 'axios';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperResponse {
  organic?: SerperSearchResult[];
  searchParameters?: {
    q: string;
    num: number;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

/**
 * Search the web using Serper.dev API
 * Free tier: 2,500 searches (no credit card needed!)
 */
export async function searchWeb(
  query: string,
  options: {
    start?: number;
    num?: number; // Results per page (max 100)
    domain?: string; // Optional: restrict to specific domain (e.g., "recht.nl")
  } = {}
): Promise<SearchResult[]> {
  if (!SERPER_API_KEY) {
    throw new Error('Serper API key not configured. Sign up at https://serper.dev for 2,500 free searches!');
  }

  const { start = 0, num = 20, domain } = options;

  // Build query with optional site restriction
  let searchQuery = query;
  if (domain) {
    searchQuery = `${query} site:${domain}`;
  }

  try {
    const response = await axios.post<SerperResponse>(
      'https://google.serper.dev/search',
      {
        q: searchQuery,
        num: Math.min(num, 100), // Max 100 results
        page: Math.floor(start / num) + 1, // Convert offset to page number
      },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.data.organic || response.data.organic.length === 0) {
      return [];
    }

    return response.data.organic.map(item => {
      const url = new URL(item.link);
      return {
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        domain: url.hostname,
      };
    });
  } catch (error: any) {
    console.error('[Serper Search] Error:', error.response?.data || error.message);
    throw new Error(`Serper Search failed: ${error.response?.data?.message || error.message}`);
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
