import { searchWeb, extractECLIs } from './serper-search';
import { validateECLI } from './validator';
import { fetchDecisionContent } from '../rechtspraak-api';
import type { PreparedRecord } from '@shared/schema';
import axios from 'axios';
import { isFullUrl, crawlUrlWithPagination } from './url-crawler';

export interface DiscoveryProgress {
  type: 'search_start' | 'search_results' | 'url_fetch' | 'ecli_found' | 
        'ecli_validated' | 'discovery_complete' | 'error';
  message: string;
  url?: string;
  ecli?: string;
  resultsFound?: number;
  totalEclis?: number;
  validEclis?: number;
}

/**
 * Discover ECLIs from web search results
 */
export async function discoverEclisFromSearch(
  query: string,
  options: {
    domains?: string[]; // Optional: restrict to specific domains
    maxResults?: number;
    onProgress?: (progress: DiscoveryProgress) => Promise<void>;
  } = {}
): Promise<{ eclis: string[]; preparedRecords: PreparedRecord[] }> {
  const { domains = [], maxResults = 20, onProgress } = options;
  
  const allEclis = new Set<string>();
  const ecliSources = new Map<string, string[]>(); // ECLI -> source URLs
  
  // Separate URLs from domains
  const urls = domains.filter(d => isFullUrl(d));
  const domainsOnly = domains.filter(d => !isFullUrl(d));
  
  // First, crawl any provided URLs with pagination
  for (const url of urls) {
    if (onProgress) {
      await onProgress({
        type: 'search_start',
        message: `Crawling URL met paginering: ${url}`,
      });
    }
    
    try {
      const { eclis: urlEclis, ecliToUrlMap } = await crawlUrlWithPagination(url, {
        maxPages: 10,
        onProgress: async (progress) => {
          if (onProgress) {
            await onProgress({
              type: 'url_fetch',
              message: progress.message,
              url: progress.url,
            });
          }
        },
      });
      
      // Add discovered ECLIs with correct source URL (from the page where it was found)
      urlEclis.forEach(ecli => {
        allEclis.add(ecli);
        if (!ecliSources.has(ecli)) {
          ecliSources.set(ecli, []);
        }
        // Use the ACTUAL URL where this ECLI was found (not just the base URL)
        const sourceUrl = ecliToUrlMap.get(ecli);
        if (sourceUrl && !ecliSources.get(ecli)!.includes(sourceUrl)) {
          ecliSources.get(ecli)!.push(sourceUrl);
        }
      });
      
      if (onProgress) {
        await onProgress({
          type: 'ecli_found',
          message: `${urlEclis.length} ECLI's gevonden via URL crawling`,
          totalEclis: allEclis.size,
        });
      }
    } catch (error: any) {
      console.error(`[Discovery] URL crawling failed for ${url}:`, error);
      if (onProgress) {
        await onProgress({
          type: 'error',
          message: `URL crawling mislukt: ${error.message}`,
        });
      }
    }
  }
  
  // Then, search domains using Serper (if any)
  const searchDomains = domainsOnly.length > 0 ? domainsOnly : (urls.length === 0 ? [''] : []);
  
  for (const domain of searchDomains) {
    if (onProgress) {
      await onProgress({
        type: 'search_start',
        message: domain 
          ? `Zoeken op ${domain}...` 
          : 'Zoeken op het web...',
      });
    }
    
    try {
      // Search with optional domain restriction
      const results = await searchWeb(query, {
        num: maxResults,
        domain: domain || undefined,
      });
      
      if (onProgress) {
        await onProgress({
          type: 'search_results',
          message: `${results.length} resultaten gevonden`,
          resultsFound: results.length,
        });
      }
      
      // Extract ECLIs from search result snippets and fetch full pages
      for (const result of results) {
        // Extract from snippet first
        const snippetEclis = extractECLIs(result.snippet);
        snippetEclis.forEach(ecli => {
          allEclis.add(ecli);
          if (!ecliSources.has(ecli)) {
            ecliSources.set(ecli, []);
          }
          ecliSources.get(ecli)!.push(result.url);
        });
        
        // Fetch full page content to find more ECLIs
        try {
          if (onProgress) {
            await onProgress({
              type: 'url_fetch',
              message: `Scannen: ${result.domain}`,
              url: result.url,
            });
          }
          
          const pageResponse = await axios.get(result.url, {
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; RechtspraakBot/1.0)',
            },
          });
          
          const pageEclis = extractECLIs(pageResponse.data);
          pageEclis.forEach(ecli => {
            allEclis.add(ecli);
            if (!ecliSources.has(ecli)) {
              ecliSources.set(ecli, []);
            }
            if (!ecliSources.get(ecli)!.includes(result.url)) {
              ecliSources.get(ecli)!.push(result.url);
            }
          });
          
          if (onProgress && pageEclis.length > 0) {
            await onProgress({
              type: 'ecli_found',
              message: `${pageEclis.length} ECLI's gevonden op ${result.domain}`,
              totalEclis: allEclis.size,
            });
          }
        } catch (fetchError) {
          // Skip pages that fail to fetch
          console.log(`[Discovery] Failed to fetch ${result.url}:`, fetchError);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (searchError: any) {
      console.error(`[Discovery] Search failed for domain ${domain}:`, searchError);
      if (onProgress) {
        await onProgress({
          type: 'error',
          message: `Zoeken mislukt: ${searchError.message}`,
        });
      }
    }
  }
  
  // Validate ECLIs via Rechtspraak API
  const validEclis: string[] = [];
  const preparedRecords: PreparedRecord[] = [];
  
  for (const ecli of Array.from(allEclis)) {
    try {
      // Validate and fetch metadata in one call
      const validationResult = await validateECLI(ecli, 'metadata-only');
      
      if (validationResult.isValid && validationResult.enrichedRecord) {
        validEclis.push(ecli);
        
        if (onProgress) {
          await onProgress({
            type: 'ecli_validated',
            message: `Valideren: ${ecli}`,
            ecli,
            validEclis: validEclis.length,
          });
        }
        
        // Use the enriched record with source URL from discovery
        const sourceUrl = ecliSources.get(ecli)?.[0] || validationResult.enrichedRecord.sourceUrl;
        preparedRecords.push({
          ...validationResult.enrichedRecord,
          sourceUrl,
          source: 'web_search', // Tag as web search origin → goes to WEB_ECLI namespace
        });
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.log(`[Discovery] Validation failed for ${ecli}:`, error);
    }
  }
  
  if (onProgress) {
    await onProgress({
      type: 'discovery_complete',
      message: `${validEclis.length} geldige ECLI's gevonden`,
      totalEclis: allEclis.size,
      validEclis: validEclis.length,
    });
  }
  
  return {
    eclis: validEclis,
    preparedRecords,
  };
}
