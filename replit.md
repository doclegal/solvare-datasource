# Rechtspraak Ingestie Tool

## Projectoverzicht

Een web-applicatie voor het ophalen en verwerken van Nederlandse rechterlijke uitspraken van de Open Data API van Rechtspraak.nl en deze voorbereiden voor opslag als vector records in Pinecone.

**Doel**: Uitspraken van Nederlandse rechtbanken ophalen, full-text extraheren, en uploaden naar Pinecone voor semantische zoekopdrachten.

**BELANGRIJKE KWALITEITSFILTER**: Alleen zaken met een geldige **Inhoudsindicatie** (officiële samenvatting in `<summary>` veld) worden opgehaald. Zaken zonder inhoudsindicatie, met een lege inhoudsindicatie, of met alleen een "-" (streepje) worden automatisch uitgefilterd om datakwaliteit te waarborgen.

## Architectuur

### Frontend
- **Framework**: React met TypeScript
- **Styling**: Tailwind CSS + Shadcn UI componenten
- **State Management**: React hooks (useState)
- **API Communicatie**: Fetch API met custom apiRequest helper
- **Taal**: Nederlands

### Backend
- **Framework**: Express.js met TypeScript
- **API Integraties**: 
  - Rechtspraak.nl Open Data API (XML)
  - Pinecone Vector Database (Node.js SDK)
- **Data Parsing**: fast-xml-parser voor XML processing
- **HTTP Client**: Axios voor externe API calls

## Functionaliteit

### 1. Rechtspraak Filters & Ophalen
- Zoek uitspraken met filters:
  - Wijzigingsdatum (maximaal 10 jaar terug)
  - Instantie (rechtbank/hof)
  - Type civiele zaak (Arbeidsrecht, Huurrecht, Consumentenrecht, etc.)
  - Alleen volledige documenten (altijd actief)
- Paginering met configureerbare batchgrootte
- Display ECLI codes met metadata

### 2. Record Voorbereiden
- Haal volledige XML content op voor geselecteerde ECLI's
- Parse XML en extraheer:
  - Titel
  - Instantie/rechtbank
  - Uitspraakdatum
  - Rechtsgebied(en)
  - Proceduresoort
  - Volledige tekst van de uitspraak
  - Bron URL
- Display prepared records met preview

### 3. Intelligente Chunking (NIEUW - Dual Mode)
Splits uitspraken in logische secties voor betere semantische zoekopdrachten met **twee parallelle methodes**:

#### A. Keyword-Based Chunking (Traditioneel)
- **Section Detection** met priority-gebaseerde keyword matching:
  - `summary`: Inhoudsindicatie, samenvatting
  - `claims`: Vorderingen (in conventie/reconventie)
  - `facts`: Feiten, procesverloop, partijen
  - `reasoning`: Beoordeling, overwegingen, motivering
  - `decision`: Beslissing, dictum
  - `other`: Overige tekst
- Identificeert secties op basis van kopjes in de tekst

#### B. LLM Semantic Chunking (NIEUW - Experimenteel)
- **AI-Powered Classification**: OpenAI GPT-4o bepaalt semantisch welk tekstdeel bij welke sectie hoort
- **Structuur-Bewust**: Prompt geeft LLM context over standaard opbouw (Feiten → Vorderingen → Verweer → Beoordeling → Beslissing)
- **Paragraph Segmentation**: Splitst tekst in paragraphs (~300 woorden) voor classificatie
- **Section Types**: Summary, Feiten, Vorderingen/Claims, Juridische Beoordeling, Beslissing
- **Confidence Scores**: Elk chunk krijgt confidence score (0.0-1.0) van de LLM
- **Strikte Validatie**: Controleert op complete classificatie en duplicate IDs
- **Automatic Fallback**: Bij LLM failures wordt keyword-based methode gebruikt
- **Cost**: ~$0.05 per uitspraak (~11k tokens @ GPT-4o rates)

**Gemeenschappelijke Features:**
- **Automatische Text Splitting**: Lange secties (>700 woorden) worden gesplitst in chunks van ~600 woorden met 120-woord overlap
- **Rijke Metadata Extractie** per chunk:
  - Civil domain (employment_law, tenancy, consumer_law, etc.)
  - Case subtype (termination, eviction, non_conformity, noise_nuisance, etc.)
  - Outcome (claim_allowed/partly_allowed/rejected, appeal_upheld/dismissed, etc.)
  - Party types (employee/employer, tenant/landlord, consumer/trader, etc.)
  - Court level (kanton, rechtbank, gerechtshof, hoge_raad)
  - Procedure type (kort_geding, bodemprocedure, hoger_beroep, cassatie)
  - Statutes & articles (geëxtraheerd via regex: "Art 6:162 BW", etc.)
- **UI Preview**: Expandable accordion met chunk counts per section type en color-coded badges
- **Metadata Tracking**: classification_method (keyword/llm/keyword-fallback), confidence, model version

### 4. Pinecone Export
- Upload prepared records OF chunks naar Pinecone index
- **Chunks** worden individueel opgeslagen met 30+ metadata velden voor filtering
- Configureerbaar:
  - Index host
  - Namespace (optioneel)
  - Batchgrootte (aanbevolen: 100-500)
- Real-time voortgang via Server-Sent Events (SSE)
- Foutafhandeling met gedetailleerde logging

## API Endpoints

### Backend Routes

#### `POST /api/rechtspraak/search`
Zoek uitspraken in Rechtspraak Open Data API.

**Request Body**:
```json
{
  "batchSize": 50,
  "dateFrom": "2024-01-01",
  "dateTo": "2024-12-31",
  "documentType": "Uitspraak",
  "court": "HR",
  "legalArea": "Civiel",
  "fullDocumentsOnly": true,
  "from": 0
}
```

**Response**:
```json
{
  "records": [...],
  "totalResults": 1234
}
```

#### `POST /api/rechtspraak/content`
Haal volledige content op voor ECLI's.

**Request Body**:
```json
{
  "eclis": ["ECLI:NL:HR:2024:123", ...]
}
```

**Response**:
```json
{
  "success": true,
  "records": [...],
  "errors": [...],
  "total": 10,
  "successful": 9,
  "failed": 1
}
```

#### `POST /api/rechtspraak/create-batch`
Maak server-side batch van records (voorkomt HTTP 413 bij chunk preparation).

**Request Body**:
```json
{
  "records": [PreparedRecord[], ...]
}
```

**Response**:
```json
{
  "success": true,
  "batchId": "uuid-...",
  "recordCount": 25
}
```

#### `POST /api/rechtspraak/prepare-chunks`
Prepare chunks met keyword-based sectie-detectie en metadata extractie.

**Request Body**:
```json
{
  "batchId": "uuid-..."
}
```

**Response**:
```json
{
  "success": true,
  "totalChunks": 45,
  "totalRecords": 10,
  "chunksByEcli": {...},
  "allChunks": [...]
}
```

#### `POST /api/rechtspraak/prepare-chunks-llm`
Prepare chunks met LLM semantische classificatie (experimenteel).

**Request Body**:
```json
{
  "batchId": "uuid-..."
}
```

**Response**:
```json
{
  "success": true,
  "totalChunks": 45,
  "totalRecords": 10,
  "fallbackCount": 2,
  "method": "llm",
  "chunks": [
    {
      "chunk_id": "ECLI:NL:HR:2024:123#facts-0",
      "section_type": "facts",
      "text": "...",
      "classification_method": "llm",
      "classification_confidence": 0.95,
      "llm_model": "gpt-4.1-mini",
      "prompt_version": "v1.0",
      ...
    }
  ]
}
```

#### `POST /api/pinecone/export`
Export records OF chunks naar Pinecone (streaming via SSE).

**Request Body**:
```json
{
  "indexHost": "my-index-abc123.svc.region.pinecone.io",
  "namespace": "rechtspraak-uitspraken",
  "batchSize": 100,
  "records": [...],  // PreparedRecord[] OF ChunkedRecord[]
  "isChunked": true  // Optional: true voor chunks, false voor records
}
```

**Response**: Server-Sent Events stream met progress updates

#### `GET /api/health`
Health check endpoint.

## Externe APIs

### Rechtspraak Open Data API
- **Base URL**: `https://data.rechtspraak.nl/uitspraken`
- **Zoeken**: `/zoeken?{parameters}`
- **Content**: `/content?id={ECLI}`
- **Formaat**: XML (Atom feed)
- **Rate limiting**: 200ms delay tussen requests

### Pinecone API
- **SDK**: `@pinecone-database/pinecone` (Node.js)
- **Auth**: API key via environment variable `PINECONE_API_KEY`
- **Operations**: 
  - Inference API voor embedding generation (model: multilingual-e5-large)
  - Upsert vectors met embeddings en metadata
- **Embedding Model**: multilingual-e5-large (ondersteunt Nederlands)
- **Limits**: Zie Pinecone documentatie voor embedding tokens en upsert rates

## Environment Variables

### Vereist
- `PINECONE_API_KEY`: API key voor Pinecone authenticatie

### Optioneel
- `NODE_ENV`: development/production
- `PORT`: Server poort (default: 5000)

## Installatie & Setup

```bash
# Installeer dependencies
npm install

# Start development server
npm run dev
```

## Data Flow

1. **Zoeken**: Gebruiker stelt filters in → Frontend → Backend → Rechtspraak API → ECLI lijst (met paginering)
2. **Content ophalen**: ECLI lijst → Backend → Rechtspraak content API → XML parsing → Structured records met volledige tekst
3. **Chunking** (optioneel): Prepared records → Backend chunking engine → Intelligente sectie-detectie + metadata extractie → Chunks met 30+ velden
4. **Export**: Prepared records OF chunks → Backend → Pinecone Inference API (embedding generation) → Pinecone upsert (batched) → Vector database

### Paginering
- Bij eerste zoekopdracht: `from=0`
- Bij volgende pagina's: `from` wordt verhoogd met `batchSize`
- Gebruiker kan steeds meer resultaten ophalen door opnieuw te zoeken

## Schema Types

Zie `shared/schema.ts` voor TypeScript types:
- `EcliRecord`: Basis ECLI metadata
- `PreparedRecord`: Volledige record met content
- `ChunkedRecord`: Chunk met section_type en uitgebreide metadata (30+ velden)
- `SearchFilters`: Zoekfilters
- `ExportConfig`: Pinecone export configuratie

## Componenten

### Frontend Components
- `Header`: App header met status badge
- `FilterSection`: Zoekfilters voor Rechtspraak API
- `EcliTable`: Tabel met opgehaalde ECLI records + paginering
- `RecordPreparation`: Full content ophalen en preview
- `PineconeExport`: Export configuratie en voortgang

### Backend Modules
- `rechtspraak-api.ts`: Rechtspraak API client functies
- `chunking.ts`: Intelligente sectie-detectie en metadata extractie
- `pinecone-client.ts`: Pinecone upload logica
- `routes.ts`: Express route handlers

## Bijzonderheden

### Chunking Engine
- **Priority-based Section Detection**: Decision keywords worden EERST gecheckt om mislabeling te voorkomen ("Beslissing in conventie" → `decision`, niet `claims`)
- **Heading Normalization**: Verwijdert nummering (1., 2.1, etc.) en punctuatie voor robuuste matching
- **Preamble Handling**: Tekst voor eerste heading wordt als aparte `summary` section opgeslagen
- **Empty Chunk Prevention**: Guards tegen lege chunks, infinite loops, en undefined crashes
- **Outcome Inference**: Check specifieke phrases EERST ("gedeeltelijk toegewezen" voor "toegewezen")
- **Statute Extraction**: Regex pattern detecteert "Art X BW", "Art X:Y Rv", etc.

### XML Parsing
- Rechtspraak gebruikt complex XML formaat (RDF + custom namespaces)
- Recursive text extraction voor volledige tekst
- Fallback naar abstract als geen volledige tekst beschikbaar

### Rate Limiting
- 200ms delay tussen Rechtspraak content requests
- Pinecone: 100ms delay tussen batches
- Vermijd "hammering the server" (zie Rechtspraak docs)

### Error Handling
- Graceful degradation bij partial failures
- Detailed error logging in UI
- Retry-able operations waar mogelijk
- procedureType guard voorkomt crashes bij missing values

## Toekomstige Verbeteringen

Potentiële uitbreidingen (niet geïmplementeerd):
- Filter presets opslaan
- Selective ECLI processing (checkboxes)
- Local embedding generation
- Export naar JSON/CSV
- Ingestion history dashboard
- Incremental updates (wijzigingsdatum tracking)

## Documentatie

Zie `attached_assets/` voor:
- `Open Data rechtspraak_*.pdf`: Rechtspraak API documentatie
- `API Pinecone_*.txt`: Pinecone API referentie

## Laatste Update

16 november 2024 - Inhoudsindicatie Filtering (KRITISCH):
- **KWALITEITSFILTER**: Alleen zaken met geldige Inhoudsindicatie worden opgehaald
- Filter verwijdert automatisch:
  - Lege summaries (empty string)
  - Streepje-alleen summaries ("-")
  - Whitespace-only summaries
- Inhoudsindicaties beschikbaar sinds minstens 2006 in `<summary>` veld
- UI toont nu Inhoudsindicatie kolom in ECLI tabel
- Backend logt gefilterde records voor debugging
- Court filter fix: HR (Hoge Raad) mapping naar volledige URI werkt nu correct

14 november 2024 - LLM Semantic Chunking v2.0 (verbeterd):
- **Upgraded Model**: GPT-4o (was GPT-4.1 Mini) voor betere reasoning
- **Structuur-Bewuste Prompt**: Geeft LLM context over standaard opbouw Nederlandse uitspraken
  - Feiten & Procesverloop → Vorderingen → Verweer → Juridische Beoordeling → Beslissing
- **Strikte Validatie**: Controleert op complete classificatie, duplicate IDs, missing paragraphs
- **Unique Chunk IDs**: Global counter per section type voorkomt duplicate keys
- **UI Toggle**: Gebruiker kan kiezen tussen keyword en AI chunking methodes
- **Automatic Fallback**: Bij LLM errors wordt keyword-based methode gebruikt
- **Confidence Tracking**: Elk chunk krijgt confidence score van LLM
- **Metadata**: classification_method, classification_confidence, llm_model (gpt-4o), prompt_version (v2.0)

14 november 2024 - Periode beperking + batch management:
- **Zoekperiode beperkt** tot maximaal 10 jaar terug
- Standaardperiode: "Afgelopen tien jaar"
- "Alles" optie verwijderd om database belasting te beperken
- Server-side batch management met batchId voor HTTP 413 preventie
- Atomic state management met refs voor race condition preventie

14 november 2024 - Intelligente chunking implementatie:
- Priority-based section detection met keyword matching
- Automatische text splitting voor lange secties (600 woorden met 120 overlap)
- Rijke metadata extractie: civil_domain, case_subtype, outcome, party types, statutes
- UI preview met accordion en color-coded section badges
- Production-ready chunking engine met guards tegen crashes en lege chunks
- Preamble handling: aparte summary section met heading context preservation

13 november 2024 - Initiële implementatie:
- Nederlandse interface (alle teksten in het Nederlands)
- Rechtspraak Open Data API integratie met XML parsing
- Pinecone Inference API voor automatische embedding generation
- Werkende paginering voor grote resultatensets
- Real-time progress feedback via SSE
- Robuste error handling voor partial failures
