# Rechtspraak Ingestie Tool

## Projectoverzicht

Een web-applicatie voor het ophalen en verwerken van Nederlandse rechterlijke uitspraken van de Open Data API van Rechtspraak.nl en deze voorbereiden voor opslag als vector records in Pinecone.

**Doel**: Uitspraken van Nederlandse rechtbanken ophalen, full-text extraheren, en uploaden naar Pinecone voor semantische zoekopdrachten.

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
  - Uitspraakdatum (van-tot)
  - Wijzigingsdatum (van-tot)
  - Documenttype (Uitspraak/Conclusie)
  - Instantie (rechtbank/hof)
  - Rechtsgebied (Civiel/Straf/Bestuurs/Europees)
  - Alleen volledige documenten optie
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

### 3. Pinecone Export
- Upload prepared records naar Pinecone index
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

#### `POST /api/pinecone/export`
Export records naar Pinecone (streaming via SSE).

**Request Body**:
```json
{
  "indexHost": "my-index-abc123.svc.region.pinecone.io",
  "namespace": "rechtspraak-uitspraken",
  "batchSize": 100,
  "records": [...]
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
- **Operations**: Upsert vectors met metadata
- **Limits**: Zie Pinecone documentatie

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

1. **Zoeken**: Gebruiker stelt filters in → Frontend → Backend → Rechtspraak API → ECLI lijst
2. **Content ophalen**: ECLI lijst → Backend → Rechtspraak content API → XML parsing → Structured records
3. **Export**: Prepared records → Backend → Pinecone upsert (batched) → Vector database

## Schema Types

Zie `shared/schema.ts` voor TypeScript types:
- `EcliRecord`: Basis ECLI metadata
- `PreparedRecord`: Volledige record met content
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
- `pinecone-client.ts`: Pinecone upload logica
- `routes.ts`: Express route handlers

## Bijzonderheden

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

13 november 2024 - Volledige implementatie met Nederlandse interface
