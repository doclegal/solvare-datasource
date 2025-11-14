import type { PreparedRecord, ChunkedRecord } from '@shared/schema';

/**
 * Section keywords to identify different parts of a legal decision
 * Using contains-match with priority ordering (check decision before claims)
 */
const SECTION_KEYWORDS = {
  // Priority order matters: decision should be checked before claims
  decision: [
    'beslissing',
    'dictum',
    'veroordeelt',
    'wijst af',
    'verklaart',
  ],
  summary: [
    'inhoudsindicatie',
    'samenvatting',
    'korte inhoud',
  ],
  claims: [
    'vordering',
    'het verzoek',
    // Don't include conventie/reconventie here - they're in "Beslissing in conventie"
    'vorderingen in conventie',
    'vorderingen in reconventie',
  ],
  facts: [
    'feiten',
    'vaststaande feiten',
    'de zaak in het kort',
    'procesgang',
    'procesverloop',
    'verloop van het geding',
  ],
  reasoning: [
    'beoordeling',
    'overwegingen',
    'juridische beoordeling',
    'motivering',
    'rechtsoverwegingen',
    'slotsom',
  ],
};

/**
 * Normalize heading by removing numbering and punctuation
 */
function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/^[\d\.\s]+/, '') // Remove leading numbers like "1.", "2.1", etc.
    .replace(/[:\.\-]+$/g, '') // Remove trailing punctuation
    .trim();
}

/**
 * Identify section type based on heading text (robust contains-match with priority)
 * Priority: decision > summary > claims > facts > reasoning
 */
function identifySectionType(heading: string): 'summary' | 'claims' | 'facts' | 'reasoning' | 'decision' | 'other' {
  const normalized = normalizeHeading(heading);
  
  // Check section types in priority order (decision first to avoid "beslissing in conventie" → claims)
  const priorityOrder: Array<keyof typeof SECTION_KEYWORDS> = ['decision', 'summary', 'claims', 'facts', 'reasoning'];
  
  for (const type of priorityOrder) {
    const keywords = SECTION_KEYWORDS[type];
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return type;
      }
    }
  }
  
  return 'other';
}

/**
 * Split text into chunks of approximately targetWords words
 * Fixed to prevent empty chunks and ensure proper overlap
 */
function splitTextIntoChunks(text: string, targetWords: number = 600, overlapWords: number = 120): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0); // Filter empty strings
  
  if (words.length === 0) {
    return []; // Return empty array for empty text
  }
  
  if (words.length <= targetWords) {
    return [text.trim()];
  }
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < words.length) {
    const end = Math.min(start + targetWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    
    if (chunk.trim().length > 0) { // Only add non-empty chunks
      chunks.push(chunk);
    }
    
    // Move forward but keep overlap
    // If we're at the last segment, break to avoid infinite loop
    if (end >= words.length) {
      break;
    }
    
    start += targetWords - overlapWords;
    
    // Guard against infinite loop if overlap is too large
    if (start >= words.length) {
      break;
    }
  }
  
  return chunks;
}

/**
 * Extract enhanced metadata from prepared record and full text
 */
export function extractMetadata(record: PreparedRecord, fullText: string) {
  const year = record.decisionDate ? parseInt(record.decisionDate.split('-')[0]) : undefined;
  const textLower = fullText.toLowerCase();
  
  // Determine court level from court name
  let courtLevel = 'unknown';
  const courtLower = record.court.toLowerCase();
  if (courtLower.includes('kanton')) {
    courtLevel = 'kanton';
  } else if (courtLower.includes('rechtbank')) {
    courtLevel = 'rechtbank';
  } else if (courtLower.includes('gerechtshof') || courtLower.includes('hof')) {
    courtLevel = 'gerechtshof';
  } else if (courtLower.includes('hoge raad') || courtLower === 'hr') {
    courtLevel = 'hoge_raad';
  }
  
  // Check if kanton case
  const isKantonCase = courtLevel === 'kanton';
  
  // Infer civil domain from legal area
  let civilDomain = 'other_civil';
  let caseSubtype: string | undefined = undefined;
  const legalAreaStr = record.legalArea.join(' ').toLowerCase();
  
  if (legalAreaStr.includes('arbeidsrecht')) {
    civilDomain = 'employment_law';
    // Detect subtypes
    if (textLower.includes('ontslag') || textLower.includes('beëindiging')) {
      caseSubtype = 'termination_of_employment';
    } else if (textLower.includes('loon') || textLower.includes('salaris')) {
      caseSubtype = 'payment_of_wages';
    }
  } else if (legalAreaStr.includes('huurrecht') || legalAreaStr.includes('huur')) {
    if (legalAreaStr.includes('woonruimte') || textLower.includes('woningen')) {
      civilDomain = 'residential_tenancy';
      if (textLower.includes('ontruiming')) {
        caseSubtype = 'eviction';
      } else if (textLower.includes('huurachterstand')) {
        caseSubtype = 'rent_arrears';
      }
    } else {
      civilDomain = 'commercial_tenancy';
    }
  } else if (legalAreaStr.includes('consumentenrecht')) {
    civilDomain = 'consumer_law';
    if (textLower.includes('non-conformiteit') || textLower.includes('gebrek')) {
      caseSubtype = 'non_conformity';
    }
  } else if (legalAreaStr.includes('goederenrecht')) {
    civilDomain = 'property_law';
  } else if (legalAreaStr.includes('verbintenissen')) {
    civilDomain = 'general_contract_law';
  } else if (legalAreaStr.includes('insolventie')) {
    civilDomain = 'debt_collection';
  } else if (legalAreaStr.includes('burenrecht')) {
    civilDomain = 'neighbour_dispute';
    if (textLower.includes('geluidshinder') || textLower.includes('geluidsoverlast')) {
      caseSubtype = 'noise_nuisance';
    } else if (textLower.includes('erfafscheiding') || textLower.includes('grens')) {
      caseSubtype = 'boundary_dispute';
    }
  }
  
  // Infer procedure type (guard against undefined/null)
  let procedureTypeNormalized = 'unknown';
  const procLower = (record.procedureType || '').toLowerCase();
  if (procLower.includes('kort geding')) {
    procedureTypeNormalized = 'kort_geding';
  } else if (procLower.includes('bodem') || procLower.includes('bodemprocedure')) {
    procedureTypeNormalized = 'bodemprocedure';
  } else if (procLower.includes('hoger beroep') || procLower.includes('appel')) {
    procedureTypeNormalized = 'hoger_beroep';
  } else if (procLower.includes('cassatie')) {
    procedureTypeNormalized = 'cassatie';
  } else if (procLower.includes('verzoekschrift')) {
    procedureTypeNormalized = 'verzoekschriftprocedure';
  }
  
  // Infer outcome from decision text (check specific phrases before generic ones)
  let outcome: string | undefined = undefined;
  if (textLower.includes('gedeeltelijk toegewezen')) {
    // Check specific "partly allowed" before generic "allowed"
    outcome = 'claim_partly_allowed';
  } else if (textLower.includes('toegewezen') || textLower.includes('toewijzen')) {
    outcome = 'claim_allowed';
  } else if (textLower.includes('afgewezen') || textLower.includes('wijst af')) {
    outcome = 'claim_rejected';
  } else if (textLower.includes('bekrachtigt') || textLower.includes('bekrachtiging')) {
    outcome = 'appeal_upheld';
  } else if (textLower.includes('vernietigt') || textLower.includes('vernietiging')) {
    outcome = 'appeal_dismissed';
  } else if (textLower.includes('verwerpt') && courtLevel === 'hoge_raad') {
    outcome = 'cassation_dismissed';
  }
  
  // Infer party types based on domain
  let party1Type: string | undefined = undefined;
  let party2Type: string | undefined = undefined;
  
  if (civilDomain === 'employment_law') {
    party1Type = 'employee';
    party2Type = 'employer';
  } else if (civilDomain === 'residential_tenancy' || civilDomain === 'commercial_tenancy') {
    party1Type = 'tenant';
    party2Type = 'landlord';
  } else if (civilDomain === 'consumer_law') {
    party1Type = 'consumer';
    party2Type = 'trader';
  } else if (civilDomain === 'neighbour_dispute') {
    party1Type = 'home_owner';
    party2Type = 'neighbour';
  } else if (civilDomain === 'debt_collection') {
    party1Type = 'debtor';
    party2Type = 'creditor';
  }
  
  // Extract statute references
  const statutes: string[] = [];
  const statutePattern = /art(?:ikel)?\s+(\d+(?:[a-z])?(?::\d+)?)\s+(?:lid\s+\d+\s+)?(?:BW|Rv|Wet|EVRM)/gi;
  let match;
  while ((match = statutePattern.exec(fullText)) !== null) {
    const statute = match[0].trim();
    if (!statutes.includes(statute)) {
      statutes.push(statute);
    }
  }
  
  return {
    decision_year: year,
    court_level: courtLevel,
    is_kanton_case: isKantonCase,
    civil_domain: civilDomain,
    case_subtype: caseSubtype,
    procedure_type: procedureTypeNormalized,
    outcome,
    party_1_type: party1Type,
    party_2_type: party2Type,
    statutes_and_articles: statutes.length > 0 ? statutes : undefined,
  };
}

/**
 * Parse full text into sections based on headings
 * Preamble text (before first heading) becomes separate 'summary' section
 * Headings are included in section text for context preservation
 */
function parseIntoSections(fullText: string): Array<{ type: string; text: string; heading?: string }> {
  const sections: Array<{ type: string; text: string; heading?: string }> = [];
  
  // Split by lines
  const lines = fullText.split('\n');
  let currentSection: { type: string; text: string; heading?: string } | null = null;
  let preambleText = '';
  let hasSeenHeading = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check if this line is a heading (short, often numbered, and followed by content)
    const isLikelyHeading = trimmed.length > 0 && 
                           trimmed.length < 100 && 
                           !trimmed.endsWith('.');
    
    if (isLikelyHeading) {
      const sectionType = identifySectionType(trimmed);
      
      // If we identified a known section type, start new section
      if (sectionType !== 'other') {
        // If we have preamble and haven't seen a heading yet, save preamble as summary
        if (!hasSeenHeading && preambleText.trim()) {
          sections.push({
            type: 'summary',
            text: preambleText,
          });
          preambleText = '';
        }
        
        hasSeenHeading = true;
        
        // Push previous section if exists
        if (currentSection && currentSection.text.trim()) {
          sections.push(currentSection);
        }
        
        // Create new section, include heading in text for context
        currentSection = {
          type: sectionType,
          text: line + '\n', // Include heading line in text
          heading: trimmed,
        };
        continue;
      }
    }
    
    // Add line to current section or preamble
    if (hasSeenHeading && currentSection) {
      currentSection.text += line + '\n';
    } else {
      // No heading yet, accumulate in preamble
      preambleText += line + '\n';
    }
  }
  
  // Push final section
  if (currentSection && currentSection.text.trim()) {
    sections.push(currentSection);
  }
  
  // If only preamble exists (no headings found), classify as summary
  if (!hasSeenHeading && preambleText.trim()) {
    sections.push({
      type: 'summary',
      text: preambleText,
    });
  }
  
  return sections;
}

/**
 * Create summary chunk from Inhoudsindicatie or fallback to extracted facts/reasoning
 */
function createSummaryChunk(record: PreparedRecord, baseMetadata: any): ChunkedRecord | null {
  let summaryText = '';
  
  // Priority 1: Use Inhoudsindicatie if available
  if (record.inhoudsindicatie && record.inhoudsindicatie.trim()) {
    summaryText = record.inhoudsindicatie.trim();
    console.log(`[${record.ecli}] Using Inhoudsindicatie for summary chunk`);
  } else {
    // Priority 2: Extract from Facts + Reasoning sections
    console.log(`[${record.ecli}] No Inhoudsindicatie found, extracting from Facts + Reasoning`);
    
    const sections = parseIntoSections(record.fullText);
    const factsSection = sections.find(s => s.type === 'facts');
    const reasoningSection = sections.find(s => s.type === 'reasoning');
    
    let combinedText = '';
    if (factsSection) {
      combinedText += factsSection.text + '\n\n';
    }
    if (reasoningSection) {
      // Take first ~300 words of reasoning
      const reasoningWords = reasoningSection.text.split(/\s+/).slice(0, 300);
      combinedText += reasoningWords.join(' ');
    }
    
    if (!combinedText.trim()) {
      // Ultimate fallback: take first ~200 words of full text, skip preamble
      const words = record.fullText.split(/\s+/);
      // Skip first 50 words (likely preamble/header)
      const contentWords = words.slice(50, 250);
      summaryText = contentWords.join(' ');
    } else {
      // Take first 3-5 sentences from combined text
      const sentences = combinedText.match(/[^.!?]+[.!?]+/g) || [];
      summaryText = sentences.slice(0, 5).join(' ').trim();
    }
  }
  
  if (!summaryText) {
    return null;
  }
  
  return {
    ecli: record.ecli,
    chunk_id: `${record.ecli}#summary-0`,
    section_type: 'summary',
    title: record.title,
    source_url: record.sourceUrl,
    text: summaryText,
    
    is_civil: true,
    is_kanton_case: baseMetadata.is_kanton_case,
    civil_domain: baseMetadata.civil_domain,
    case_subtype: baseMetadata.case_subtype,
    procedure_type: baseMetadata.procedure_type,
    court_level: baseMetadata.court_level,
    court_name: record.court,
    
    decision_date: record.decisionDate,
    decision_year: baseMetadata.decision_year,
    outcome: baseMetadata.outcome,
    
    party_1_type: baseMetadata.party_1_type,
    party_2_type: baseMetadata.party_2_type,
    
    statutes_and_articles: baseMetadata.statutes_and_articles,
  };
}

/**
 * Create chunks from a prepared record
 */
export function createChunksFromRecord(record: PreparedRecord): ChunkedRecord[] {
  const chunks: ChunkedRecord[] = [];
  const baseMetadata = extractMetadata(record, record.fullText);
  
  // Step 1: Create summary chunk from Inhoudsindicatie or fallback
  const summaryChunk = createSummaryChunk(record, baseMetadata);
  if (summaryChunk) {
    chunks.push(summaryChunk);
  }
  
  // Step 2: Parse text into sections (skip preamble - it's in summary now)
  const sections = parseIntoSections(record.fullText);
  
  // Track chunk indices per section type
  const sectionCounters: Record<string, number> = {};
  
  // Start counter at 1 for summary since we already have summary-0
  sectionCounters['summary'] = summaryChunk ? 1 : 0;
  
  for (const section of sections) {
    const sectionType = section.type as ChunkedRecord['section_type'];
    
    // Skip summary sections - we already have the summary chunk from Inhoudsindicatie
    if (sectionType === 'summary') {
      continue;
    }
    
    // Initialize counter for this section type
    if (!sectionCounters[sectionType]) {
      sectionCounters[sectionType] = 0;
    }
    
    // For long sections (facts/reasoning), split into chunks
    const shouldSplit = (sectionType === 'facts' || sectionType === 'reasoning') && 
                        section.text.split(/\s+/).filter(w => w.length > 0).length > 700;
    
    const textChunks = shouldSplit ? splitTextIntoChunks(section.text) : [section.text];
    
    for (const textChunk of textChunks) {
      const trimmedChunk = textChunk.trim();
      
      // Skip empty chunks
      if (trimmedChunk.length === 0) {
        continue;
      }
      
      const chunkIndex = sectionCounters[sectionType]++;
      const chunkId = `${record.ecli}#${sectionType}-${chunkIndex}`;
      
      chunks.push({
        // Basic identifiers
        ecli: record.ecli,
        chunk_id: chunkId,
        section_type: sectionType,
        title: record.title,
        source_url: record.sourceUrl,
        text: trimmedChunk,
        
        // Civil focus
        is_civil: true,
        is_kanton_case: baseMetadata.is_kanton_case,
        civil_domain: baseMetadata.civil_domain,
        case_subtype: baseMetadata.case_subtype,
        procedure_type: baseMetadata.procedure_type,
        court_level: baseMetadata.court_level,
        court_name: record.court,
        
        // Date and outcome
        decision_date: record.decisionDate,
        decision_year: baseMetadata.decision_year,
        outcome: baseMetadata.outcome,
        
        // Parties
        party_1_type: baseMetadata.party_1_type,
        party_2_type: baseMetadata.party_2_type,
        
        // Statutes
        statutes_and_articles: baseMetadata.statutes_and_articles,
      });
    }
  }
  
  return chunks;
}
