# Juridische Databronnen

## Overview

This project is a web application designed to retrieve and process Dutch legal documents from multiple sources into a Pinecone vector database for semantic search. It supports four main data sources:

1. **Rechtspraak.nl** - Court decisions with AI enrichment and quality filtering
2. **BWB (Basis Wetten Bestand)** - National legislation via KOOP SRU API
3. **CVDR (Decentrale Regelgeving)** - Provincial and municipal regulations via DRP API
4. **DSO-LV (Digitaal Stelsel Omgevingswet)** - Environmental plans and regulations under the Omgevingswet

The application uses PostgreSQL for duplicate tracking and ensures data quality by preventing redundant processing across different namespaces.

## User Preferences

- All text and UI elements should be in Dutch.
- I prefer clear, concise explanations and direct interaction.
- I appreciate real-time progress feedback, especially for long-running operations.
- I want the tool to prioritize data quality, specifically by filtering out records without valid summaries.
- The system should prevent duplicate processing of ECLI records.
- I prefer to be informed about the status of operations, including successful and failed attempts.
- Web search discoveries should be routed to the `WEB_ECLI` namespace, while API search results go to the `ECLI_NL` namespace.

## System Architecture

The application follows a client-server architecture with a React-based frontend and an Express.js backend.

### UI/UX Decisions
- **Framework**: React with TypeScript.
- **Styling**: Tailwind CSS and Shadcn UI components provide a modern and consistent interface.
- **Language**: All UI elements and communications are in Dutch.
- **Interaction**: Features like configurable batch sizes, real-time progress via Server-Sent Events (SSE), and detailed error logging aim to provide a transparent and efficient user experience. Filtering options allow users to narrow down rulings by modification date and civil case types, with a critical quality filter for valid 'Inhoudsindicatie'.

### Technical Implementations
- **Frontend**: React hooks for state management and `apiRequest` helper for backend communication.
- **Backend**: Express.js with TypeScript.
- **Database**: PostgreSQL (Neon) for duplicate tracking, managed via Drizzle ORM.
- **API Integration**: Handles XML from Rechtspraak.nl using `fast-xml-parser` and interacts with Pinecone using its Node.js SDK. Axios for external API calls.
- **Data Processing**:
    - **ECLI Discovery System**: Modular architecture with breadth-first section crawling (Cheerio-based HTML parsing, BFS crawler with rate limiting, Regex-based ECLI detection, Rechtspraak API validation). Includes web search (Serper.dev) and URL pagination crawling.
    - **Pinecone Export**: Uploads metadata records to a hardcoded Pinecone index, routing records to `WEB_ECLI` (web search) or `ECLI_NL` (API search) namespaces based on their source. Uses `multilingual-e5-large` for dense embeddings and DJB2 hashing for sparse vectors.
    - **AI Enrichment**: Real-time upload of enriched records to Pinecone with automatic namespace routing and batch resume capability.
    - **Automatic Persistence**: Fetched records are auto-saved to PostgreSQL batch storage and auto-restored on page load.
    - **Chunking Engine (Optional)**: Advanced chunking with priority-based section detection, heading normalization, and metadata extraction. Experimental LLM-based semantic chunking is also available.
- **Concurrency & Rate Limiting**: Implements delays for Rechtspraak API and Pinecone batch requests.
- **Error Handling**: Graceful degradation, detailed UI logging, and retry mechanisms.

### System Design Choices
- **Duplicate Tracking**: A `processed_eclis` table in PostgreSQL tracks processed ECLIs, with automatic backend marking after successful Pinecone upload, ensuring namespace accuracy.
- **Source-based Namespace Routing**: Records are tagged with their origin (`web_search` or `api_search`) and automatically routed to the appropriate Pinecone namespace during export.
- **Server-side Batch Management**: For chunk preparation, records are batched server-side to handle large payloads.
- **Metadata-Only Export**: Primary Pinecone export strategy uses only the "Inhoudsindicatie" as a vector, with ECLI as the unique vector ID.

## External Dependencies

- **Rechtspraak Open Data API**:
    - **Base URL**: `https://data.rechtspraak.nl/uitspraken`
    - **Endpoints**: `/zoeken`, `/content`.
    - **Format**: XML (Atom feed).

- **Pinecone Vector Database**:
    - **SDK**: `@pinecone-database/pinecone` (Node.js).
    - **Embedding Model**: `multilingual-e5-large`.
    - **Index Host**: `rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io`.
    - **Namespaces**: 
        - `WEB_ECLI` - Court decisions from web search
        - `ECLI_NL` - Court decisions from API search
        - `laws-current` - Currently valid national legislation
        - `laws-local` - Provincial and municipal regulations
        - `laws-dso` - Environmental regulations under the Omgevingswet (DSO)

- **CVDR/DRP API**:
    - **Base URL**: `https://zoekservice.overheid.nl/sru/Search`
    - **Collection**: CVDR (Centrale Voorziening Decentrale Regelgeving)
    - **Format**: XML via SRU protocol
    - Used for provincial and municipal legislation discovery and download.

- **DSO-LV API (Digitaal Stelsel Omgevingswet)**:
    - **Base URL (PRE-PRODUCTIE)**: `https://service.pre.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v7`
    - **Base URL (Productie)**: `https://service.omgevingswet.overheid.nl/publiek/omgevingsdocumenten/api/presenteren/v8`
    - **Huidige omgeving**: PRE-PRODUCTIE (test data, beperkte filtermogelijkheden)
    - **Authentication**: API key required (request at developer.omgevingswet.overheid.nl)
    - **Secret**: `DSO_API_KEY` (PRE-productie key)
    - **Format**: JSON REST API (HAL+JSON)
    - **Document Types**: Omgevingsplan, Omgevingsverordening, Waterschapsverordening, Omgevingsvisie, Programma, Projectbesluit
    - **Limitaties PRE-productie**: Filtering op typeBevoegdGezag/documentType niet ondersteund via API
    - Used for searching and retrieving omgevingsdocumenten (environmental plans under the Omgevingswet).

- **PostgreSQL (Neon)**:
    - Used for duplicate tracking and batch management.

- **Serper.dev API**:
    - Used for web search ECLI discovery.

## Recent Changes

### 2025-12-03: Upload Verificatie Systeem
**Feature**: Alle uploads naar Pinecone worden nu geverifieerd na voltooiing. Dit voorkomt stille fouten waarbij uploads onvolledig zijn maar als succes worden gerapporteerd.

**Probleem opgelost**: Bij grote wetten (zoals de Awb met 801 chunks) kon het voorkomen dat slechts een deel van de chunks daadwerkelijk in Pinecone terechtkwam (bijv. 200 van 801), terwijl de UI meldde dat de upload succesvol was.

**Oplossing**:
1. **Verificatiefunctie**: `verifyLawUploadInPinecone()` telt het daadwerkelijke aantal vectoren in Pinecone na upload
2. **Return type aangepast**: Upload functies retourneren nu `{ verified, expected, isComplete }`
3. **Route logica**: Uploads worden alleen als succes gemarkeerd wanneer verificatie bevestigt dat ALLE chunks aanwezig zijn
4. **UI feedback**: Toont "geüpload en geverifieerd ✓" met exacte tellingen (bijv. "177/177")

**Scope**: Verificatie is toegepast op:
- Nationale wetgeving (BWB) → `laws-current` namespace
- Lokale regelgeving (CVDR) → `laws-local` namespace  
- DSO/Omgevingswet → `laws-dso` namespace

**Techniek**: Gebruikt Pinecone's `listPaginated()` met BWB-ID prefix om alle vectoren te enumereren.

### 2025-12-02: DSO Omgevingsplannen Chunking & Pinecone Upload
**Feature**: Complete implementation of DSO document processing pipeline for uploading Omgevingswet documents to Pinecone.

**Components Added**:
1. **Database Tracking**: New `uploaded_dso_regelingen` table for duplicate prevention with content hash
2. **Storage Functions**: `trackUploadedDsoRegeling`, `isDsoRegelingVersionUploaded`, `checkDsoRegelingDuplicates`
3. **API Routes**: 
   - POST `/api/omgevingsplannen/check-duplicates` - Check if documents are already in Pinecone
   - POST `/api/omgevingsplannen/download` - Download, chunk and upload selected documents (SSE progress)
4. **Frontend**: Updated Omgevingsplannen.tsx with document selection checkboxes, upload button, and real-time progress display

**Workflow**: Search documents → Select documents → Click "Upload naar Pinecone" → Documents are chunked and uploaded to `laws-dso` namespace

**Namespace**: `laws-dso` in Pinecone for all DSO/Omgevingswet documents

### 2025-12-02: Fixed article number truncation bug (COMPLETE FIX)
**Problem**: Article numbers like "2.20", "3.20" were being stored as "2.2", "3.2" in Pinecone, losing trailing zeros. This caused articles like "Artikel 2.20 - Rechten verbonden aan het merk" from the Benelux IP treaty (BWBV0001716) to be missing from the database.

**Root Cause**: The `fast-xml-parser` library has TWO settings that affect numeric conversion:
1. `parseAttributeValue` - Controls conversion of attribute values (e.g., `status="2.20"`)
2. `parseTagValue` - Controls conversion of text content (e.g., `<nr>2.20</nr>`)

The initial fix only set `parseAttributeValue: false`, but the article numbers in XML are stored as text content (`<nr>2.20</nr>`), not attributes. This meant the text "2.20" was still being converted to the JavaScript number `2.2`.

**Complete Solution**: Added `parseTagValue: false` to all three XML parser configurations:
- `server/koop-sru-service.ts` - BWB national legislation (lines 28-35)
- `server/drp-service.ts` - CVDR local regulations (lines 26-33)
- `server/rechtspraak-api.ts` - Court decisions (lines 14-20)

**Verification**: After this fix, article numbers are correctly preserved as strings:
```
Before: kop.nr._text = 2.2 (number)
After:  kop.nr._text = "2.20" (string)
```

**Action Required**: Re-download and re-upload affected laws (like BWBV0001716) to Pinecone to get the missing articles with correct numbering.