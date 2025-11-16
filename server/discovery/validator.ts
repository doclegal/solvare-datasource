/**
 * ECLI Validator Module
 * Validates ECLI numbers via Rechtspraak API
 */

import { fetchDecisionContent } from '../rechtspraak-api';

export interface ValidationResult {
  ecli: string;
  isValid: boolean;
  metadata?: {
    title: string;
    court: string;
    decisionDate: string;
    legalArea: string[];
    procedureType: string;
    inhoudsindicatie: string;
    sourceUrl: string;
  };
  error?: string;
}

/**
 * Validate a single ECLI via Rechtspraak API
 * Returns validation result with metadata if valid
 */
export async function validateECLI(ecli: string): Promise<ValidationResult> {
  try {
    // fetchDecisionContent returns PreparedRecord directly or throws on error
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
    
    return {
      ecli,
      isValid: true,
      metadata: {
        title: record.title,
        court: record.court,
        decisionDate: record.decisionDate,
        legalArea: record.legalArea,
        procedureType: record.procedureType,
        inhoudsindicatie: record.inhoudsindicatie,
        sourceUrl: record.sourceUrl,
      },
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
