/**
 * ECLI Discovery Service
 * Orchestrates the complete discovery flow:
 * 1. Crawl URLs
 * 2. Extract ECLIs
 * 3. Validate via Rechtspraak API
 * 4. Process through existing pipeline
 */

import { crawlUrls, type CrawlResult } from './crawler';
import { extractECLIs, type ExtractedECLI } from './extractor';
import { validateECLIs, type ValidationResult } from './validator';
import { db, processedEclis } from '../db';
import { eq, and, inArray } from 'drizzle-orm';
import type { PreparedRecord } from '@shared/schema';

export interface DiscoveryResult {
  url: string;
  crawled: boolean;
  crawlError?: string;
  eclisFound: number;
  eclisValidated: number;
  eclisNew: number;
  eclisProcessed: number;
  errors: string[];
}

export interface DiscoveryProgress {
  type: 'crawl' | 'extract' | 'validate' | 'check_processed' | 'complete' | 'error';
  message: string;
  url?: string;
  eclisFound?: number;
  ecli?: string;
  totalUrls?: number;
  currentUrl?: number;
  results?: DiscoveryResult[];
}

/**
 * Main discovery service
 * Returns prepared records ready for pipeline processing
 */
export async function discoverECLIs(
  sourceUrls: string[],
  namespace: string = 'ECLI_NL',
  onProgress?: (progress: DiscoveryProgress) => void
): Promise<{
  preparedRecords: PreparedRecord[];
  results: DiscoveryResult[];
}> {
  const results: DiscoveryResult[] = [];
  const allPreparedRecords: PreparedRecord[] = [];
  
  // Map to track source URLs per ECLI
  const ecliToSources = new Map<string, Set<string>>();
  
  // Step 1: Crawl all URLs
  onProgress?.({
    type: 'crawl',
    message: `Crawling ${sourceUrls.length} URL(s)...`,
    totalUrls: sourceUrls.length,
  });
  
  const crawlResults = await crawlUrls(sourceUrls, (url, result) => {
    onProgress?.({
      type: 'crawl',
      message: result.robotsAllowed 
        ? `Crawled: ${url}` 
        : `Blocked by robots.txt: ${url}`,
      url,
    });
  });
  
  // Step 2: Extract ECLIs from each crawled page
  const allExtractedECLIs: ExtractedECLI[] = [];
  
  for (let i = 0; i < crawlResults.length; i++) {
    const crawlResult = crawlResults[i];
    const sourceUrl = sourceUrls[i];
    
    const result: DiscoveryResult = {
      url: sourceUrl,
      crawled: crawlResult.robotsAllowed && crawlResult.html !== null,
      crawlError: crawlResult.error || undefined,
      eclisFound: 0,
      eclisValidated: 0,
      eclisNew: 0,
      eclisProcessed: 0,
      errors: [],
    };
    
    if (!crawlResult.html) {
      if (crawlResult.error) {
        result.errors.push(crawlResult.error);
      }
      results.push(result);
      continue;
    }
    
    // Extract ECLIs from HTML
    onProgress?.({
      type: 'extract',
      message: `Extracting ECLIs from: ${sourceUrl}`,
      url: sourceUrl,
      currentUrl: i + 1,
      totalUrls: sourceUrls.length,
    });
    
    const extractedECLIs = extractECLIs(crawlResult.html, sourceUrl);
    result.eclisFound = extractedECLIs.length;
    
    onProgress?.({
      type: 'extract',
      message: `Found ${extractedECLIs.length} ECLI(s) on: ${sourceUrl}`,
      url: sourceUrl,
      eclisFound: extractedECLIs.length,
    });
    
    // Track source URLs for each ECLI
    extractedECLIs.forEach(extracted => {
      if (!ecliToSources.has(extracted.ecli)) {
        ecliToSources.set(extracted.ecli, new Set());
      }
      ecliToSources.get(extracted.ecli)!.add(sourceUrl);
    });
    
    allExtractedECLIs.push(...extractedECLIs);
    results.push(result);
  }
  
  // Get unique ECLIs
  const uniqueECLIs = Array.from(new Set(allExtractedECLIs.map(e => e.ecli)));
  
  if (uniqueECLIs.length === 0) {
    onProgress?.({
      type: 'complete',
      message: 'No ECLIs found on any of the URLs',
      results,
    });
    return { preparedRecords: [], results };
  }
  
  onProgress?.({
    type: 'extract',
    message: `Total unique ECLIs found: ${uniqueECLIs.length}`,
  });
  
  // Step 3: Check which ECLIs are already processed
  onProgress?.({
    type: 'check_processed',
    message: 'Checking for already processed ECLIs...',
  });
  
  const processedECLIs = await db
    .select({ ecli: processedEclis.ecli })
    .from(processedEclis)
    .where(
      and(
        eq(processedEclis.namespace, namespace),
        inArray(processedEclis.ecli, uniqueECLIs)
      )
    );
  
  const processedSet = new Set(processedECLIs.map(p => p.ecli));
  const newECLIs = uniqueECLIs.filter(ecli => !processedSet.has(ecli));
  
  onProgress?.({
    type: 'check_processed',
    message: `${newECLIs.length} new ECLIs (${processedSet.size} already processed)`,
  });
  
  if (newECLIs.length === 0) {
    onProgress?.({
      type: 'complete',
      message: 'All found ECLIs have already been processed',
      results,
    });
    return { preparedRecords: [], results };
  }
  
  // Step 4: Validate new ECLIs
  onProgress?.({
    type: 'validate',
    message: `Validating ${newECLIs.length} ECLI(s) via Rechtspraak API...`,
  });
  
  const validationResults = await validateECLIs(newECLIs, (ecli, result) => {
    onProgress?.({
      type: 'validate',
      message: result.isValid 
        ? `✓ Valid: ${ecli}` 
        : `✗ Invalid: ${ecli} (${result.error})`,
      ecli,
    });
  });
  
  // Step 5: Prepare records with alsoReadOn metadata
  validationResults.forEach(validation => {
    if (validation.isValid && validation.metadata) {
      const sourceUrls = Array.from(ecliToSources.get(validation.ecli) || []);
      
      const preparedRecord: PreparedRecord = {
        ecli: validation.ecli,
        title: validation.metadata.title,
        court: validation.metadata.court,
        decisionDate: validation.metadata.decisionDate,
        legalArea: validation.metadata.legalArea,
        procedureType: validation.metadata.procedureType,
        sourceUrl: validation.metadata.sourceUrl,
        inhoudsindicatie: validation.metadata.inhoudsindicatie,
        alsoReadOn: sourceUrls,
      };
      
      allPreparedRecords.push(preparedRecord);
      
      // Update result statistics
      const firstSourceUrl = sourceUrls[0];
      const result = results.find(r => r.url === firstSourceUrl);
      if (result) {
        result.eclisValidated++;
        result.eclisNew++;
      }
    } else {
      // Track validation errors
      const sourceUrls = Array.from(ecliToSources.get(validation.ecli) || []);
      const firstSourceUrl = sourceUrls[0];
      const result = results.find(r => r.url === firstSourceUrl);
      if (result && validation.error) {
        result.errors.push(`${validation.ecli}: ${validation.error}`);
      }
    }
  });
  
  onProgress?.({
    type: 'complete',
    message: `Discovery complete: ${allPreparedRecords.length} valid new ECLIs ready for processing`,
    results,
  });
  
  return {
    preparedRecords: allPreparedRecords,
    results,
  };
}
