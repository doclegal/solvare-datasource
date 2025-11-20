# Rechtspraak Ingestie Tool

## Overview

This project is a web application designed to retrieve and process Dutch judicial rulings from the Rechtspraak.nl Open Data API. Its primary purpose is to extract full-text content, apply quality filters, and prepare this data for storage as vector records in Pinecone, enabling semantic search capabilities. The application focuses on ingesting cases with valid "Inhoudsindicatie" (official summaries) and uses a PostgreSQL database for duplicate tracking, ensuring data quality and preventing redundant processing across different namespaces.

**AI ENRICHMENT WITH RESUME (November 2025)**: The system features a robust AI enrichment pipeline with automatic resume functionality:
1. User starts AI enrichment for any number of records (no limit)
2. **Batch Resume**: If enrichment is interrupted (server restart, errors), users can resume from the BatchManager:
   - Incomplete batches show a "Hervat" (Resume) button
   - Only non-enriched records are processed (skips records with `ai_title`)
   - Preserves all metadata including `source` field for correct namespace routing
3. **Error Resilience**: Individual record failures don't abort the entire batch - enrichment continues with remaining records
4. **Progress Tracking**: Real-time SSE streaming shows progress, errors, and completion status
5. **PostgreSQL Persistence**: All batches stored in database with 24-hour retention, surviving server restarts
6. **Manual Upload**: Enriched records uploaded to Pinecone via manual button click (auto-upload worker disabled)

**AUTO-SAVE FEATURE (November 2025)**: The system automatically saves fetched records to prevent data loss:
1. **First-Fetch Auto-Save**: When users fetch records for the first time in a session, the system automatically saves them to PostgreSQL batch storage
   - Silent background operation - no user action required
   - Triggered immediately after successful fetch
   - Creates batch with 24-hour retention
2. **Safety Guarantees**: Multiple safeguards prevent duplicate batch creation:
   - **First-Fetch-Only**: Auto-save triggers ONLY when no batch exists yet (`currentBatchId === null`)
   - **Race Condition Guard**: Ref-based lock (`autoSaveInProgressRef`) prevents concurrent auto-saves from rapid double-clicks
   - **Resume/Load Protection**: Loading or resuming a batch sets `currentBatchId`, preventing duplicate auto-saves on subsequent fetches
   - **Silent Fail**: Errors don't interrupt user workflow - auto-save fails gracefully with log message
3. **Behavior**:
   - ✅ First fetch → auto-saves batch
   - ❌ Second fetch in same session → no auto-save (batch already exists)
   - ❌ Discovery adding records → no auto-save (user must manually save to include discovered records)
   - ✅ Reset filters → clears batch ID, allows new auto-save on next fetch
   - ✅ Clear records → clears batch ID, allows new auto-save on next fetch
   - ❌ Resume batch → sets batch ID, prevents duplicate auto-save
   - ❌ Load batch → sets batch ID, prevents duplicate auto-save
4. **Rollback Instructions**: To disable auto-save, set feature flag in `client/src/pages/Home.tsx`:
   ```typescript
   const ENABLE_AUTO_SAVE = false; // Change from true to false
   ```
   - No API changes required
   - Frontend-only modification
   - Restores manual-save-only behavior
5. **Implementation Details**:
   - Location: `client/src/pages/Home.tsx` (lines 141-169)
   - API endpoint: `POST /api/batches/save`
   - Response includes: `{ success, batchId, recordCount, message }`
   - State tracking: `currentBatchId` (null = no batch, string = batch exists)
   - Guards: `autoSaveInProgressRef` (prevents concurrent saves)

**ECLI Discovery Feature**: The system includes a modular web crawling feature that discovers ECLI numbers on external legal websites. Users provide URLs, the system crawls them (respecting robots.txt and implementing rate limiting), extracts ECLI patterns via regex, validates them against the Rechtspraak API, and automatically adds them to the processing pipeline.

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
- **Interaction**: Features like configurable batch sizes, real-time progress via Server-Sent Events (SSE), and detailed error logging aim to provide a transparent and efficient user experience. Tables display ECLI codes with metadata, and previews are available for prepared records.
- **Filtering**: Search filters allow users to narrow down rulings by modification date (max 10 years back), automatically including all instances (courts, appeal courts, Supreme Court), and specific civil case types. A critical quality filter ensures only cases with valid 'Inhoudsindicatie' are processed.

### Technical Implementations
- **Frontend**: Utilizes React hooks for state management and the Fetch API with a custom `apiRequest` helper for backend communication.
- **Backend**: Built with Express.js and TypeScript.
- **Database**: PostgreSQL (Neon) is used for duplicate tracking of processed ECLIs, managed via Drizzle ORM.
- **API Integration**: Handles XML data from Rechtspraak.nl using `fast-xml-parser` and interacts with Pinecone using its Node.js SDK. Axios is used for external API calls.
- **Data Processing**:
    - **Metadata Retrieval**: Efficiently extracts metadata (Title, Court, Date, Legal Area, Procedure Type, Inhoudsindicatie, Source URL) for selected ECLIs without fetching full text initially.
    - **ECLI Discovery System**: Modular architecture with breadth-first section crawling:
        - **Link Extractor** (`server/discovery/link-extractor.ts`): Cheerio-based HTML parsing with same-domain and same-path-prefix filtering. Uses trailing slash normalization to prevent lexical supersets (e.g., `/civil/` won't match `/civilian/`). Deduplicates links and removes fragments.
        - **Section Crawler** (`server/discovery/section-crawler.ts`): BFS (queue-based) crawler with configurable limits (maxDepth=3, maxPages=75 by default). Implements per-host rate limiting (1s + jitter), visited tracking, depth management, and continues on individual page failures. Real-time SSE progress callbacks.
        - **Base Crawler** (`server/discovery/crawler.ts`): Fetches HTML from URLs with robots.txt compliance, host-level rate limiting (1s between requests to same host), and 1-hour robots.txt cache.
        - **Extractor** (`server/discovery/extractor.ts`): Regex-based ECLI detection (`ECLI:[A-Z]{2}:[A-Z0-9]+:\d{4}:[A-Z0-9]+`), normalization to uppercase, and deduplication.
        - **Validator** (`server/discovery/validator.ts`): Verifies ECLIs via Rechtspraak API, extracts metadata for valid cases.
        - **Service** (`server/discovery/service.ts`): Orchestrates breadth-first section crawling per root URL. Maintains global ECLI → Set<sourceUrls> map for deduplication. Sequential section processing. Creates PreparedRecords from validated ECLI data.
        - **API Endpoint**: `/api/ecli-discovery/ingest` with SSE streaming for real-time progress feedback. Accepts optional config: `maxDepth` (1-10), `maxPages` (1-500), `delayMs` (100-5000ms).
        - **Frontend Component**: `EcliDiscovery.tsx` with dynamic URL inputs, live status updates (pages crawled, depth, queue size), and automatic integration into preparation pipeline.
        - **Default URLs**: Preconfigured with 10 legal websites covering various practice areas (huurrecht, arbeidsrecht, bestuursrecht, consumentenrecht) including Academie voor de Rechtspraktijk, cassatieblog.nl, recht.nl, TRIP Advocaten, Stibbe, Unger Nolet, NJB, Benk, Yspeert, and Wijnenstael.
    - **Pinecone Export**: Uploads metadata records to a hardcoded Pinecone index (`rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io`). Records are routed to namespaces based on their source:
        - **Web Search discoveries** → `WEB_ECLI` namespace (records tagged with `source: 'web_search'`)
        - **API Search results** → `ECLI_NL` namespace (records tagged with `source: 'api_search'`)
        - Embedding generation uses the `multilingual-e5-large` model.
    - **Hybrid Search**: All records are uploaded with both dense and sparse vectors for optimal retrieval:
        - **Dense Vectors**: Generated via Pinecone's `multilingual-e5-large` embedding model for semantic similarity matching.
        - **Sparse Vectors**: Deterministic term-frequency based vectors using DJB2 hashing (32-bit) with Dutch character preservation, Unicode normalization (NFD), and top 1000 highest-weighted terms. Enables precise keyword matching alongside semantic search.
        - **Tokenization**: Lowercase conversion, NFD normalization, extended Latin character support (`\u00C0-\u024F`), minimum token length of 3 characters.
        - **Query-time**: The same `generateSparseVector()` function must be used for queries to ensure hash consistency between indexed vectors and query vectors.
    - **Chunking Engine (Optional)**: Features an advanced chunking engine with priority-based section detection, heading normalization, and preamble handling. It can automatically split long sections and extracts rich metadata (e.g., civil_domain, case_subtype, outcome, statutes). An experimental LLM-based semantic chunking method (using GPT-4o) with confidence tracking and automatic fallback is also available.
- **Concurrency & Rate Limiting**: Implements a 200ms delay between Rechtspraak API requests and a 100ms delay between Pinecone batches to respect API limits.
- **Error Handling**: Includes graceful degradation, detailed error logging in the UI, and retry mechanisms where applicable.

### System Design Choices
- **Duplicate Tracking**: A `processed_eclis` table in PostgreSQL tracks already processed ECLIs based on a composite unique key (namespace, ecli), preventing redundant API calls and uploads.
  - **Automatic Backend Tracking (November 2025)**: The backend automatically marks ECLIs as processed in the correct namespace immediately after successful Pinecone upload. This eliminates frontend manual tracking and ensures namespace accuracy:
    - Web search records → marked in WEB_ECLI namespace after upload to WEB_ECLI
    - API search records → marked in ECLI_NL namespace after upload to ECLI_NL
    - No manual /api/processed-eclis/mark calls needed from frontend
- **Source-based Namespace Routing**: Records are tagged with their origin (`web_search` or `api_search`) and automatically routed to the appropriate Pinecone namespace (`WEB_ECLI` or `ECLI_NL` respectively) during export.
  - Export handler splits records by `source` field before upload
  - Each namespace upload is tracked independently in the database
  - SSE progress events include namespace-specific breakdowns
- **Server-side Batch Management**: For chunk preparation, records are batched server-side to prevent HTTP 413 errors with large payloads.
- **Metadata-Only Export**: The primary Pinecone export strategy focuses on ingesting only the "Inhoudsindicatie" as a vector, with the ECLI serving as the unique vector ID.

## External Dependencies

- **Rechtspraak Open Data API**:
    - **Base URL**: `https://data.rechtspraak.nl/uitspraken`
    - **Endpoints**: `/zoeken` for search, `/content` for ECLI content.
    - **Format**: XML (Atom feed).
    - **Rate Limit**: 200ms delay between requests.

- **Pinecone Vector Database**:
    - **SDK**: `@pinecone-database/pinecone` (Node.js).
    - **Authentication**: `PINECONE_API_KEY` environment variable.
    - **Embedding Model**: `multilingual-e5-large` (supports Dutch).
    - **Operations**: Upsert vectors with embeddings and metadata.
    - **Index Host (Hardcoded)**: `rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io`.
    - **Namespaces**: 
        - `WEB_ECLI` for web search discoveries
        - `ECLI_NL` for API search results

- **PostgreSQL (Neon)**:
    - Used for duplicate tracking of processed ECLIs.