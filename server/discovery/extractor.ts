/**
 * ECLI Extractor Module
 * Extracts and normalizes ECLI numbers from HTML content
 * 
 * NOTE: Only matches Dutch ECLIs (ECLI:NL:...) because:
 * - Rechtspraak.nl API only contains Dutch case law
 * - EU ECLIs (ECLI:EU:C:, ECLI:EU:T:) return 404 errors
 */

const ECLI_REGEX = /ECLI:NL:[A-Z0-9]+:\d{4}:[A-Z0-9]+/gi;

export interface ExtractedECLI {
  ecli: string;
  sourceUrl: string;
}

/**
 * Extract ECLI numbers from HTML content
 */
export function extractECLIs(html: string, sourceUrl: string): ExtractedECLI[] {
  const matches = html.match(ECLI_REGEX);
  
  if (!matches) {
    return [];
  }
  
  // Normalize: uppercase, trim, deduplicate
  const normalizedECLIs = new Set(
    matches.map(ecli => ecli.toUpperCase().trim())
  );
  
  return Array.from(normalizedECLIs).map(ecli => ({
    ecli,
    sourceUrl,
  }));
}

/**
 * Validate ECLI format (basic check before API validation)
 */
export function isValidECLIFormat(ecli: string): boolean {
  return ECLI_REGEX.test(ecli);
}
