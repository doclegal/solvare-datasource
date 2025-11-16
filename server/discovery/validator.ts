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

/**
 * Validate a single ECLI via Rechtspraak API
 * Returns validation result with metadata (AI summary best-effort)
 */
export async function validateECLI(ecli: string): Promise<ValidationResult> {
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
    
    // Step 2 & 3: Fetch full text + AI summary (best-effort)
    let enrichedRecord = record;
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
 */
export async function validateECLIs(
  eclis: string[],
  onProgress?: (ecli: string, result: ValidationResult) => void
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  for (const ecli of eclis) {
    const result = await validateECLI(ecli);
    results.push(result);
    
    if (onProgress) {
      onProgress(ecli, result);
    }
    
    // 200ms delay to respect API rate limits
    if (eclis.indexOf(ecli) < eclis.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}
