/**
 * ECLI Discovery Service
 * Orchestrates the complete discovery flow:
 * 1. Crawl sections (all pages under each root URL) using BFS
 * 2. Extract ECLIs from all crawled pages
 * 3. Validate via Rechtspraak API
 * 4. Process through existing pipeline
 */

import { crawlSection, type SectionCrawlProgress, type CrawlConfig } from './section-crawler';
import { validateECLIs } from './validator';
import { db, processedEclis } from '../db';
import { eq, and, inArray } from 'drizzle-orm';
import type { PreparedRecord } from '@shared/schema';

export interface DiscoveryResult {
  url: string;
  pagesVisited: number;
  eclisFound: number;
  eclisValidated: number;
  eclisNew: number;
  errors: string[];
}

export interface DiscoveryProgress {
  type: 'section_crawl_start' | 'section_crawl_page' | 'section_crawl_complete' | 
        'validate' | 'check_processed' | 'complete' | 'error';
  message: string;
  url?: string;
  eclisFound?: number;
  ecli?: string;
  totalUrls?: number;
  currentUrl?: number;
  sectionRoot?: string;
  currentDepth?: number;
  queueSize?: number;
  processedPages?: number;
  results?: DiscoveryResult[];
}

/**
 * Main discovery service with breadth-first section crawling
 * Returns prepared records ready for pipeline processing
 */
export async function discoverECLIs(
  sourceUrls: string[],
  namespace: string = 'ECLI_NL',
  config: Partial<CrawlConfig> = {},
  onProgress?: (progress: DiscoveryProgress) => void
): Promise<{
  preparedRecords: PreparedRecord[];
  results: DiscoveryResult[];
}> {
  const results: DiscoveryResult[] = [];
  const allPreparedRecords: PreparedRecord[] = [];
  
  // Global map to track all source URLs per ECLI (across all sections)
  const ecliToSources = new Map<string, Set<string>>();
  
  // Step 1: Crawl each section (all pages under each root URL) using BFS
  for (let i = 0; i < sourceUrls.length; i++) {
    const rootUrl = sourceUrls[i];
    
    onProgress?.({
      type: 'section_crawl_start',
      sectionRoot: rootUrl,
      message: `Starting section crawl ${i + 1}/${sourceUrls.length}: ${rootUrl}`,
      currentUrl: i + 1,
      totalUrls: sourceUrls.length,
    });
    
    // Progress handler for section crawler
    const sectionProgressHandler = (sectionProgress: SectionCrawlProgress) => {
      onProgress?.({
        type: sectionProgress.type as any,
        sectionRoot: sectionProgress.sectionRoot,
        currentUrl: typeof sectionProgress.currentUrl === 'string' ? undefined : sectionProgress.currentUrl,
        currentDepth: sectionProgress.currentDepth,
        queueSize: sectionProgress.queueSize,
        processedPages: sectionProgress.processedPages,
        eclisFound: sectionProgress.eclisFound,
        message: sectionProgress.message,
        url: typeof sectionProgress.currentUrl === 'string' ? sectionProgress.currentUrl : undefined,
      });
    };
    
    // Crawl the entire section
    const sectionResult = await crawlSection(rootUrl, config, sectionProgressHandler);
    
    // Merge ECLIs from this section into global map
    sectionResult.eclisFound.forEach((sourceUrls, ecli) => {
      if (!ecliToSources.has(ecli)) {
        ecliToSources.set(ecli, new Set());
      }
      sourceUrls.forEach(url => ecliToSources.get(ecli)!.add(url));
    });
    
    // Create result summary for this section
    results.push({
      url: rootUrl,
      pagesVisited: sectionResult.pagesVisited,
      eclisFound: sectionResult.eclisFound.size,
      eclisValidated: 0, // Will update after validation
      eclisNew: 0, // Will update after validation
      errors: sectionResult.errors,
    });
  }
  
  // Get unique ECLIs across all sections
  const uniqueECLIs = Array.from(ecliToSources.keys());
  
  if (uniqueECLIs.length === 0) {
    onProgress?.({
      type: 'complete',
      message: 'No ECLIs found in any section',
      results,
    });
    return { preparedRecords: [], results };
  }
  
  onProgress?.({
    type: 'check_processed',
    message: `Total unique ECLIs found across all sections: ${uniqueECLIs.length}`,
  });
  
  // Step 2: Check which ECLIs are already processed
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
  
  // Step 3: Validate new ECLIs
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
  
  // Step 4: Prepare records with alsoReadOn metadata (merged from all source URLs)
  validationResults.forEach(validation => {
    if (validation.isValid && validation.enrichedRecord) {
      const sourceUrlsForECLI = Array.from(ecliToSources.get(validation.ecli) || []);
      
      // Use the enrichedRecord which includes AI summary fields
      const preparedRecord: PreparedRecord = {
        ...validation.enrichedRecord,
        alsoReadOn: sourceUrlsForECLI, // Add alsoReadOn metadata
      };
      
      allPreparedRecords.push(preparedRecord);
      
      // Update statistics for sections where this ECLI was found
      sourceUrlsForECLI.forEach(srcUrl => {
        // Find the section result that contains this source URL
        const sectionResult = results.find(r => 
          srcUrl === r.url || srcUrl.startsWith(r.url)
        );
        if (sectionResult) {
          sectionResult.eclisValidated++;
          sectionResult.eclisNew++;
        }
      });
    } else {
      // Track validation errors
      const sourceUrlsForECLI = Array.from(ecliToSources.get(validation.ecli) || []);
      sourceUrlsForECLI.forEach(srcUrl => {
        const sectionResult = results.find(r => 
          srcUrl === r.url || srcUrl.startsWith(r.url)
        );
        if (sectionResult && validation.error) {
          sectionResult.errors.push(`${validation.ecli}: ${validation.error}`);
        }
      });
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
