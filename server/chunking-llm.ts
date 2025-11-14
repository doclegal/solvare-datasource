import OpenAI from 'openai';
import type { PreparedRecord, ChunkedRecord } from '../shared/schema';
import { extractMetadata } from './chunking';

// Initialize OpenAI client with Replit AI Integrations
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const PROMPT_VERSION = "v1.0";
const MODEL = "gpt-4.1-mini";

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
  const system = `Je bent een expert in het analyseren van Nederlandse rechterlijke uitspraken. 
Je taak is om tekstfragmenten te classificeren in de volgende categorieën:

1. **summary**: Inhoudsindicatie, samenvatting van de zaak
2. **facts**: Feiten, procesverloop, achtergrond, partijen, gebeurtenissen
3. **reasoning**: Beoordeling, juridische overwegingen, motivering, toetsing
4. **claims**: Vorderingen, verzoeken, standpunten partijen
5. **decision**: Beslissing, dictum, uitspraak, veroordeling

Belangrijk:
- Classificeer op basis van de SEMANTISCHE betekenis, niet op kopjes
- Feiten kunnen onder verschillende kopjes staan
- Geef een confidence score tussen 0.0 en 1.0
- Wees consistent en nauwkeurig`;

  const numberedParagraphs = paragraphs
    .map((para, idx) => `[${idx}]\n${para}`)
    .join('\n\n---\n\n');

  const user = `Classificeer de volgende tekstfragmenten uit een Nederlandse rechterlijke uitspraak:

**Zaak**: ${record.title}
**Rechtbank**: ${record.court}
**Datum**: ${record.decisionDate}
**Rechtsgebied**: ${record.legalArea.join(', ')}

**Tekstfragmenten**:
${numberedParagraphs}

Retourneer JSON met dit formaat:
{
  "classifications": [
    {
      "paragraphId": 0,
      "section": "facts",
      "confidence": 0.95,
      "reasoning": "Beschrijft gebeurtenissen en partijen"
    },
    ...
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
      temperature: 0.1, // Low temperature for consistency
      max_tokens: 4000,
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

      for (const { section, text, avgConfidence, chunkIndex } of finalChunks) {
        const chunkId = `${record.ecli}#${section}-${chunkIndex}`;
        
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
