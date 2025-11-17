/**
 * ECLI Validator Module
 * Validates ECLI numbers via Rechtspraak API
 */

import { fetchDecisionContent, fetchFullText } from '../rechtspraak-api';
import { generateAISummary } from '../openai-summary';
import type { PreparedRecord } from '@shared/schema';

export interface ValidationResult {
  ecli: string;
  isValid: boolean;
  enrichedRecord?: PreparedRecord; // Now includes AI summary fields
  error?: string;
}

export type EnrichmentMode = 'metadata-only' | 'with-summary';

/**
 * Validate a single ECLI via Rechtspraak API
 * @param ecli ECLI number to validate
 * @param enrichmentMode 'metadata-only' (fast, for discovery) or 'with-summary' (slow, includes AI)
 */
export async function validateECLI(
  ecli: string, 
  enrichmentMode: EnrichmentMode = 'metadata-only'
): Promise<ValidationResult> {
  try {
    // Step 1: Fetch metadata (required)
    const record = await fetchDecisionContent(ecli);
    
    // Check if has valid Inhoudsindicatie (required)
    const inhoudsindicatie = record.inhoudsindicatie;
    if (!inhoudsindicatie || inhoudsindicatie.trim() === '' || inhoudsindicatie.trim() === '-') {
      return {
        ecli,
        isValid: false,
        error: 'No valid Inhoudsindicatie',
      };
    }
    
    // Step 2 & 3: Fetch full text + AI summary (only if enrichment mode is 'with-summary')
    let enrichedRecord = record;
    if (enrichmentMode === 'with-summary') {
      try {
        console.log(`[${ecli}] Downloading full text...`);
        const fullText = await fetchFullText(ecli);
        
        console.log(`[${ecli}] Generating AI summary...`);
        const aiSummary = await generateAISummary(fullText, ecli);
        
        // Merge AI summary into record
        enrichedRecord = {
          ...record,
          ai_inhoudsindicatie: aiSummary.inhoudsindicatie,
          ai_feiten: aiSummary.feiten,
          ai_geschil: aiSummary.geschil,
          ai_beslissing: aiSummary.beslissing,
          ai_motivering: aiSummary.motivering,
        };
        
        console.log(`[${ecli}] ✓ With AI summary`);
      } catch (aiError: any) {
        // Graceful degradation: continue with metadata-only record
        console.warn(`[${ecli}] AI summary failed (keeping metadata): ${aiError.message}`);
      }
    } else {
      console.log(`[${ecli}] ✓ Metadata only (skipping AI summary)`);
    }
    
    return {
      ecli,
      isValid: true,
      enrichedRecord,
    };
  } catch (error: any) {
    return {
      ecli,
      isValid: false,
      error: error.message || 'Validation failed',
    };
  }
}

/**
 * Validate multiple ECLIs with delay between requests
 * @param enrichmentMode 'metadata-only' for fast discovery, 'with-summary' for full enrichment
 */
export async function validateECLIs(
  eclis: string[],
  onProgress?: (ecli: string, result: ValidationResult) => void | Promise<void>,
  enrichmentMode: EnrichmentMode = 'metadata-only'
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  for (const ecli of eclis) {
    const result = await validateECLI(ecli, enrichmentMode);
    results.push(result);
    
    if (onProgress) {
      await onProgress(ecli, result);
    }
    
    // 200ms delay to respect API rate limits
    if (eclis.indexOf(ecli) < eclis.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}
