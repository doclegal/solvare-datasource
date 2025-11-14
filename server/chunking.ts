import type { PreparedRecord, ChunkedRecord } from '@shared/schema';

/**
 * Section headings to identify different parts of a legal decision
 */
const SECTION_PATTERNS = {
  summary: [
    /^inhoudsindicatie$/i,
    /^samenvatting$/i,
    /^korte inhoud$/i,
  ],
  claims: [
    /^(de\s+)?vordering(en)?$/i,
    /^het\s+verzoek$/i,
    /^verzoek(en)?$/i,
    /^(de\s+)?vorderingen?\s+(in\s+)?conventie/i,
    /^(de\s+)?vorderingen?\s+(in\s+)?reconventie/i,
  ],
  facts: [
    /^(de\s+)?feiten$/i,
    /^vaststaande\s+feiten$/i,
    /^de\s+zaak\s+in\s+het\s+kort$/i,
    /^procesgang$/i,
    /^procesverloop$/i,
    /^(het\s+)?verloop\s+van\s+(het\s+)?geding$/i,
  ],
  reasoning: [
    /^(de\s+)?beoordeling$/i,
    /^overwegingen$/i,
    /^juridische\s+beoordeling$/i,
    /^motivering$/i,
    /^rechtsoverwegingen$/i,
    /^slotsom\s+ten\s+aanzien\s+van/i,
    /^de\s+motivering\s+van\s+de\s+beslissing$/i,
  ],
  decision: [
    /^(de\s+)?beslissing$/i,
    /^het\s+dictum$/i,
    /^beslissing\s+in\s+conventie/i,
    /^beslissing\s+in\s+reconventie$/i,
    /^de\s+(kantonrechter|voorzieningenrechter|rechtbank|hof)\s+(veroordeelt|wijst\s+af|verklaart)/i,
  ],
};

/**
 * Identify section type based on heading text
 */
function identifySectionType(heading: string): 'summary' | 'claims' | 'facts' | 'reasoning' | 'decision' | 'other' {
  const cleanHeading = heading.trim();
  
  for (const [type, patterns] of Object.entries(SECTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(cleanHeading)) {
        return type as any;
      }
    }
  }
  
  return 'other';
}

/**
 * Split text into chunks of approximately targetWords words
 */
function splitTextIntoChunks(text: string, targetWords: number = 600, overlapWords: number = 120): string[] {
  const words = text.split(/\s+/);
  
  if (words.length <= targetWords) {
    return [text];
  }
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < words.length) {
    const end = Math.min(start + targetWords, words.length);
    const chunk = words.slice(start, end).join(' ');
    chunks.push(chunk);
    
    // Move forward but keep overlap
    start += targetWords - overlapWords;
  }
  
  return chunks;
}

/**
 * Extract metadata from prepared record
 */
function extractMetadata(record: PreparedRecord) {
  const year = record.decisionDate ? parseInt(record.decisionDate.split('-')[0]) : undefined;
  
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
  const legalAreaStr = record.legalArea.join(' ').toLowerCase();
  
  if (legalAreaStr.includes('arbeidsrecht')) {
    civilDomain = 'employment_law';
  } else if (legalAreaStr.includes('huurrecht') || legalAreaStr.includes('huur')) {
    civilDomain = 'residential_tenancy';
  } else if (legalAreaStr.includes('consumentenrecht')) {
    civilDomain = 'consumer_law';
  } else if (legalAreaStr.includes('goederenrecht')) {
    civilDomain = 'property_law';
  } else if (legalAreaStr.includes('verbintenissen')) {
    civilDomain = 'general_contract_law';
  } else if (legalAreaStr.includes('insolventie')) {
    civilDomain = 'debt_collection';
  }
  
  // Infer procedure type
  let procedureTypeNormalized = 'unknown';
  const procLower = record.procedureType.toLowerCase();
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
  
  return {
    decision_year: year,
    court_level: courtLevel,
    is_kanton_case: isKantonCase,
    civil_domain: civilDomain,
    procedure_type: procedureTypeNormalized,
  };
}

/**
 * Parse full text into sections based on headings
 */
function parseIntoSections(fullText: string): Array<{ type: string; text: string; heading?: string }> {
  const sections: Array<{ type: string; text: string; heading?: string }> = [];
  
  // Split by common heading patterns (typically followed by newlines)
  const lines = fullText.split('\n');
  let currentSection: { type: string; text: string; heading?: string } | null = null;
  
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
        if (currentSection && currentSection.text.trim()) {
          sections.push(currentSection);
        }
        currentSection = {
          type: sectionType,
          text: '',
          heading: trimmed,
        };
        continue;
      }
    }
    
    // Add line to current section
    if (currentSection) {
      currentSection.text += line + '\n';
    } else {
      // No section yet, start "other"
      if (!currentSection) {
        currentSection = { type: 'other', text: '' };
      }
      currentSection.text += line + '\n';
    }
  }
  
  // Push final section
  if (currentSection && currentSection.text.trim()) {
    sections.push(currentSection);
  }
  
  return sections;
}

/**
 * Create chunks from a prepared record
 */
export function createChunksFromRecord(record: PreparedRecord): ChunkedRecord[] {
  const chunks: ChunkedRecord[] = [];
  const baseMetadata = extractMetadata(record);
  
  // Parse text into sections
  const sections = parseIntoSections(record.fullText);
  
  // Track chunk indices per section type
  const sectionCounters: Record<string, number> = {};
  
  for (const section of sections) {
    const sectionType = section.type as ChunkedRecord['section_type'];
    
    // Initialize counter for this section type
    if (!sectionCounters[sectionType]) {
      sectionCounters[sectionType] = 0;
    }
    
    // For long sections (facts/reasoning), split into chunks
    const shouldSplit = (sectionType === 'facts' || sectionType === 'reasoning') && 
                        section.text.split(/\s+/).length > 700;
    
    const textChunks = shouldSplit ? splitTextIntoChunks(section.text) : [section.text];
    
    for (const textChunk of textChunks) {
      const chunkIndex = sectionCounters[sectionType]++;
      const chunkId = `${record.ecli}#${sectionType}-${chunkIndex}`;
      
      chunks.push({
        // Basic identifiers
        ecli: record.ecli,
        chunk_id: chunkId,
        section_type: sectionType,
        title: record.title,
        source_url: record.sourceUrl,
        text: textChunk.trim(),
        
        // Civil focus
        is_civil: true,
        is_kanton_case: baseMetadata.is_kanton_case,
        civil_domain: baseMetadata.civil_domain,
        procedure_type: baseMetadata.procedure_type,
        court_level: baseMetadata.court_level,
        court_name: record.court,
        
        // Date and outcome
        decision_date: record.decisionDate,
        decision_year: baseMetadata.decision_year,
      });
    }
  }
  
  return chunks;
}
