import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AISummary {
  inhoudsindicatie: string;
  feiten: string;
  geschil: string;
  beslissing: string;
  motivering: string;
}

/**
 * Generate AI summary from full judgment text using GPT-3.5-Turbo
 * Structured output with 5 sections:
 * - Inhoudsindicatie (summary)
 * - Feiten (facts)
 * - Geschil (dispute)
 * - Beslissing (decision)
 * - Motivering (reasoning)
 */
export async function generateAISummary(fullText: string, ecli: string): Promise<AISummary> {
  try {
    console.log(`[${ecli}] Generating AI summary with GPT-3.5-Turbo...`);
    
    const prompt = `Je bent een juridische AI-assistent die Nederlandse rechtspraak samenvat. Analyseer de volgende uitspraak en maak een gestructureerde samenvatting in de volgende secties:

##Inhoudsindicatie
Korte samenvatting (2-3 zinnen) van waar de zaak over gaat.

##Feiten
Wat zijn de feitelijke gebeurtenissen die tot deze rechtszaak leidden? Beschrijf de relevante feiten chronologisch en beknopt.

##Geschil
Wat is het juridische geschil tussen partijen? Wat vordert de eiser/verzoeker en wat is de verweer van gedaagde/verweerder?

##Beslissing
Wat is de beslissing/uitspraak van de rechter? Wie krijgt gelijk en wat wordt toegewezen of afgewezen?

##Motivering
Wat is de juridische onderbouwing van de rechter? Welke wetsartikelen en juridische overwegingen worden gebruikt?

Volledige uitspraak:
${fullText.substring(0, 12000)} ${fullText.length > 12000 ? '...(tekst ingekort voor API limiet)' : ''}

BELANGRIJK: 
- Gebruik duidelijke Nederlandse taal
- Wees beknopt maar volledig
- Structureer elke sectie met de headers zoals hierboven aangegeven
- Begin elke sectie met ## gevolgd door de sectienaam`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Je bent een juridische AI-assistent gespecialiseerd in het samenvatten van Nederlandse rechtspraak. Je maakt gestructureerde samenvattingen die juridisch accuraat en beknopt zijn.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const response = completion.choices[0]?.message?.content;
    
    if (!response) {
      throw new Error('Geen response van OpenAI');
    }

    console.log(`[${ecli}] AI summary generated successfully`);
    
    // Parse the response into structured sections
    const summary = parseAISummaryResponse(response);
    
    return summary;
  } catch (error: any) {
    console.error(`[${ecli}] Error generating AI summary:`, error.message);
    throw new Error(`Fout bij genereren AI samenvatting: ${error.message}`);
  }
}

/**
 * Parse OpenAI response into structured AISummary object
 */
function parseAISummaryResponse(response: string): AISummary {
  const sections: AISummary = {
    inhoudsindicatie: '',
    feiten: '',
    geschil: '',
    beslissing: '',
    motivering: '',
  };

  // Split response by section headers
  const lines = response.split('\n');
  let currentSection: keyof AISummary | null = null;
  let currentText: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for section headers
    if (trimmed.startsWith('##')) {
      // Save previous section if exists
      if (currentSection && currentText.length > 0) {
        sections[currentSection] = currentText.join('\n').trim();
        currentText = [];
      }
      
      // Identify new section
      const header = trimmed.toLowerCase();
      if (header.includes('inhoudsindicatie')) {
        currentSection = 'inhoudsindicatie';
      } else if (header.includes('feiten')) {
        currentSection = 'feiten';
      } else if (header.includes('geschil')) {
        currentSection = 'geschil';
      } else if (header.includes('beslissing')) {
        currentSection = 'beslissing';
      } else if (header.includes('motivering')) {
        currentSection = 'motivering';
      }
    } else if (currentSection && trimmed.length > 0) {
      // Add line to current section
      currentText.push(trimmed);
    }
  }

  // Save last section
  if (currentSection && currentText.length > 0) {
    sections[currentSection] = currentText.join('\n').trim();
  }

  // Validate all sections are filled
  for (const [key, value] of Object.entries(sections)) {
    if (!value || value.length < 10) {
      console.warn(`Section '${key}' is missing or too short`);
      sections[key as keyof AISummary] = 'Niet beschikbaar';
    }
  }

  return sections;
}
