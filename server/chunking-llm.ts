import OpenAI from 'openai';
import type { PreparedRecord, ChunkedRecord } from '../shared/schema';
import { extractMetadata } from './chunking';

// Initialize OpenAI client with Replit AI Integrations
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const PROMPT_VERSION = "v2.0";
const MODEL = "gpt-4o"; // Better reasoning capabilities

// Section mapping for Dutch legal decisions
type SectionType = 'summary' | 'claims' | 'facts' | 'reasoning' | 'decision' | 'other';

interface ParagraphClassification {
  paragraphId: number;
  section: SectionType;
  confidence: number;
  reasoning?: string;
}

interface ClassificationResult {
  classifications: ParagraphClassification[];
  model: string;
  promptVersion: string;
}

/**
 * Segment full text into numbered paragraphs for LLM classification
 */
function segmentIntoParagraphs(text: string, maxWordsPerParagraph: number = 300): string[] {
  // Split on double newlines or single newlines followed by numbers/bullets
  const rawParagraphs = text
    .split(/\n\n+|\n(?=\d+\.|\-\s)/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const paragraphs: string[] = [];
  let currentParagraph = '';
  let currentWordCount = 0;

  for (const para of rawParagraphs) {
    const wordCount = para.split(/\s+/).length;
    
    if (currentWordCount + wordCount <= maxWordsPerParagraph) {
      currentParagraph += (currentParagraph ? '\n\n' : '') + para;
      currentWordCount += wordCount;
    } else {
      if (currentParagraph) {
        paragraphs.push(currentParagraph);
      }
      currentParagraph = para;
      currentWordCount = wordCount;
    }
  }
  
  if (currentParagraph) {
    paragraphs.push(currentParagraph);
  }

  return paragraphs;
}

/**
 * Create prompt for LLM classification
 */
function createClassificationPrompt(
  record: PreparedRecord,
  paragraphs: string[]
): { system: string; user: string } {
  const system = `Je bent een expert juridisch analist gespecialiseerd in Nederlandse civielrechtelijke uitspraken.

## STANDAARD OPBOUW VAN UITSPRAKEN

Nederlandse rechterlijke uitspraken volgen meestal deze vaste structuur:
1. **Feiten & Procesverloop** (begin) - Wie zijn de partijen, wat is er gebeurd, proceshistorie
2. **Vorderingen** - Wat vordert/verzoekt de eisende partij
3. **Verweer** - Wat is de reactie/het standpunt van de verwerende partij
4. **Juridische Beoordeling** - Juridische overwegingen, toetsing aan wet, motivering
5. **Beslissing/Dictum** (eind) - Uitspraak, veroordeling, wat wordt toegewezen/afgewezen

## CLASSIFICATIE CATEGORIEËN

Classificeer elk tekstfragment in PRECIES één van deze categorieën:

**summary** = Inhoudsindicatie (komt vaak helemaal aan het begin)
- Officiële korte samenvatting van de zaak
- Meestal herkenbaar aan compact, samenvattend karakter
- Staat vaak los van de rest van de tekst

**facts** = Feiten en Procesverloop
- Beschrijving van gebeurtenissen, achtergrond
- "Partijen", "De feiten", "Het procesverloop", "In de procedure"
- Namen, data, concrete gebeurtenissen
- Wat partijen hebben gedaan/gezegd in eerdere procedures

**claims** = Vorderingen, Verzoeken, Standpunten
- "De vordering", "Eiseres vordert", "[Partij] stelt zich op het standpunt"
- Wat wordt gevraagd aan de rechter
- Juridische argumenten van partijen (zowel eisende als verwerende partij)
- "Verweer", "gedaagde voert aan"

**reasoning** = Juridische Beoordeling door de Rechter
- "De kantonrechter overweegt", "Het hof is van oordeel"
- Juridische analyse, wetsartikelen, jurisprudentie
- Toetsing van argumenten aan wet/rechtspraak
- Motivering waarom iets wel/niet toewijsbaar is

**decision** = Beslissing en Dictum
- "De rechtbank beslist", "Het hof verklaart"
- "veroordeelt", "wijst af", "wijst toe"
- Concrete uitspraak wat wordt toegewezen
- Proceskostenveroordeling

## BELANGRIJKE RICHTLIJNEN

1. Gebruik de SEMANTISCHE BETEKENIS, niet letterlijke kopjes
2. Let op de POSITIE in de uitspraak (begin = vaak feiten, eind = beslissing)
3. Feiten en procesverloop komen meestal eerst
4. Juridische beoordeling bevat woorden als "overweegt", "is van oordeel"
5. Beslissing komt altijd aan het eind
6. Geef hoge confidence (>0.9) als je zeker bent, lagere (<0.7) bij twijfel
7. **ELKE paragraphId MOET EXACT ÉÉN KEER VOORKOMEN** in de output`;

  const numberedParagraphs = paragraphs
    .map((para, idx) => `[${idx}]\n${para}`)
    .join('\n\n---\n\n');

  const user = `Analyseer deze Nederlandse rechterlijke uitspraak en classificeer elk genummerd tekstfragment.

**Zaak**: ${record.title}
**Rechtbank**: ${record.court}
**Datum**: ${record.decisionDate}
**Rechtsgebied**: ${record.legalArea.join(', ')}

**TEKSTFRAGMENTEN** (totaal ${paragraphs.length} fragmenten):
${numberedParagraphs}

BELANGRIJK: Je output MOET EXACT ${paragraphs.length} classificaties bevatten (één per fragment [0] t/m [${paragraphs.length - 1}]).

Retourneer JSON met dit exacte formaat:
{
  "classifications": [
    {
      "paragraphId": 0,
      "section": "facts",
      "confidence": 0.95,
      "reasoning": "Begin van uitspraak, beschrijft partijen en gebeurtenissen"
    },
    {
      "paragraphId": 1,
      "section": "facts",
      "confidence": 0.92,
      "reasoning": "Vervolg procesverloop"
    }
    ... (${paragraphs.length} items totaal, elk uniek paragraphId van 0 t/m ${paragraphs.length - 1})
  ]
}`;

  return { system, user };
}

/**
 * Classify paragraphs using OpenAI
 */
async function classifyParagraphs(
  record: PreparedRecord,
  paragraphs: string[]
): Promise<ClassificationResult> {
  const { system, user } = createClassificationPrompt(record, paragraphs);

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2, // Slightly higher for better reasoning
      max_tokens: 8000, // More tokens for detailed reasoning
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(content);
    
    // Validate response structure
    if (!parsed.classifications || !Array.isArray(parsed.classifications)) {
      throw new Error('Invalid classification response format');
    }

    // Strict validation: must have exactly one classification per paragraph
    if (parsed.classifications.length !== paragraphs.length) {
      throw new Error(
        `Incomplete classification: expected ${paragraphs.length} classifications, got ${parsed.classifications.length}`
      );
    }

    // Check for duplicate paragraph IDs
    const paragraphIds = new Set<number>();
    for (const classification of parsed.classifications) {
      if (paragraphIds.has(classification.paragraphId)) {
        throw new Error(`Duplicate paragraphId found: ${classification.paragraphId}`);
      }
      paragraphIds.add(classification.paragraphId);
    }

    // Check all paragraph IDs are in range
    for (let i = 0; i < paragraphs.length; i++) {
      if (!paragraphIds.has(i)) {
        throw new Error(`Missing paragraphId: ${i}`);
      }
    }

    return {
      classifications: parsed.classifications,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
    };
  } catch (error: any) {
    console.error('[LLM Chunking] Classification error:', error.message);
    throw error;
  }
}

/**
 * Merge consecutive paragraphs with same section type
 */
function mergeSections(
  paragraphs: string[],
  classifications: ParagraphClassification[]
): Array<{ section: SectionType; text: string; avgConfidence: number }> {
  const sections: Array<{ section: SectionType; text: string; avgConfidence: number }> = [];
  
  let currentSection: SectionType | null = null;
  let currentText = '';
  let currentConfidences: number[] = [];

  for (let i = 0; i < classifications.length; i++) {
    const { section, confidence } = classifications[i];
    const paragraph = paragraphs[i];

    if (section === currentSection) {
      // Continue current section
      currentText += '\n\n' + paragraph;
      currentConfidences.push(confidence);
    } else {
      // Save previous section
      if (currentSection && currentText) {
        sections.push({
          section: currentSection,
          text: currentText,
          avgConfidence: currentConfidences.reduce((a, b) => a + b, 0) / currentConfidences.length,
        });
      }
      
      // Start new section
      currentSection = section;
      currentText = paragraph;
      currentConfidences = [confidence];
    }
  }

  // Save last section
  if (currentSection && currentText) {
    sections.push({
      section: currentSection,
      text: currentText,
      avgConfidence: currentConfidences.reduce((a, b) => a + b, 0) / currentConfidences.length,
    });
  }

  return sections;
}

/**
 * Split long sections into chunks with overlap
 */
function splitLongSections(
  sections: Array<{ section: SectionType; text: string; avgConfidence: number }>,
  maxWords: number = 600,
  overlapWords: number = 120
): Array<{ section: SectionType; text: string; avgConfidence: number; chunkIndex: number }> {
  const chunks: Array<{ section: SectionType; text: string; avgConfidence: number; chunkIndex: number }> = [];

  for (const { section, text, avgConfidence } of sections) {
    const words = text.split(/\s+/);
    
    if (words.length <= maxWords) {
      chunks.push({ section, text, avgConfidence, chunkIndex: 0 });
      continue;
    }

    // Split into overlapping chunks
    let chunkIndex = 0;
    for (let i = 0; i < words.length; i += maxWords - overlapWords) {
      const chunkWords = words.slice(i, i + maxWords);
      const chunkText = chunkWords.join(' ');
      chunks.push({ section, text: chunkText, avgConfidence, chunkIndex });
      chunkIndex++;
    }
  }

  return chunks;
}

/**
 * Prepare chunks using LLM classification
 */
export async function prepareChunksWithLLM(
  records: PreparedRecord[]
): Promise<{
  chunks: ChunkedRecord[];
  totalChunks: number;
  totalRecords: number;
  fallbackCount: number;
}> {
  const allChunks: ChunkedRecord[] = [];
  let fallbackCount = 0;

  for (const record of records) {
    try {
      console.log(`[LLM Chunking] Processing ${record.ecli}`);

      // Step 1: Segment full text into paragraphs
      const paragraphs = segmentIntoParagraphs(record.fullText, 300);
      console.log(`[LLM Chunking] Segmented into ${paragraphs.length} paragraphs`);

      // Step 2: Classify paragraphs with LLM
      const classificationResult = await classifyParagraphs(record, paragraphs);
      console.log(`[LLM Chunking] Classified ${classificationResult.classifications.length} paragraphs`);

      // Validate all paragraphs were classified
      if (classificationResult.classifications.length !== paragraphs.length) {
        throw new Error('Incomplete classification - falling back to keyword method');
      }

      // Check for required sections
      const sections = new Set(classificationResult.classifications.map(c => c.section));
      const requiredSections: SectionType[] = ['facts', 'reasoning', 'decision'];
      const missingRequired = requiredSections.filter(s => !sections.has(s));
      
      if (missingRequired.length > 0) {
        console.warn(`[LLM Chunking] Missing required sections: ${missingRequired.join(', ')} - low confidence results`);
      }

      // Step 3: Merge consecutive paragraphs with same section
      const mergedSections = mergeSections(paragraphs, classificationResult.classifications);
      console.log(`[LLM Chunking] Merged into ${mergedSections.length} sections`);

      // Step 4: Split long sections into chunks
      const finalChunks = splitLongSections(mergedSections);
      console.log(`[LLM Chunking] Created ${finalChunks.length} final chunks`);

      // Step 5: Extract metadata and create ChunkedRecord objects
      const metadata = extractMetadata(record, record.fullText);

      // Track global chunk counter per section type for unique IDs
      const sectionCounters: Record<string, number> = {};

      for (const { section, text, avgConfidence } of finalChunks) {
        // Increment counter for this section type
        if (!sectionCounters[section]) {
          sectionCounters[section] = 0;
        }
        const globalIndex = sectionCounters[section]++;
        
        const chunkId = `${record.ecli}#${section}-${globalIndex}`;
        
        allChunks.push({
          ecli: record.ecli,
          chunk_id: chunkId,
          section_type: section,
          title: record.title,
          source_url: record.sourceUrl,
          text,
          is_civil: true,
          court_name: record.court,
          decision_date: record.decisionDate,
          
          // Metadata from existing chunking logic
          ...metadata,
          
          // LLM classification metadata
          classification_method: 'llm',
          classification_confidence: avgConfidence,
          llm_model: classificationResult.model,
          prompt_version: classificationResult.promptVersion,
        });
      }

    } catch (error: any) {
      console.error(`[LLM Chunking] Failed for ${record.ecli}, falling back to keyword method:`, error.message);
      fallbackCount++;

      // Fallback to keyword-based chunking (import from chunking.ts)
      const { createChunksFromRecord } = await import('./chunking');
      const fallbackChunks = createChunksFromRecord(record);
      
      // Mark as fallback
      const markedChunks = fallbackChunks.map((chunk: ChunkedRecord) => ({
        ...chunk,
        classification_method: 'keyword-fallback' as const,
      }));
      
      allChunks.push(...markedChunks);
    }
  }

  return {
    chunks: allChunks,
    totalChunks: allChunks.length,
    totalRecords: records.length,
    fallbackCount,
  };
}
