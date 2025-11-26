# Juridische Databronnen

## Overview

This project is a web application designed to retrieve and process Dutch judicial rulings from the Rechtspraak.nl Open Data API. Its primary purpose is to extract full-text content, apply quality filters, and prepare this data for storage as vector records in Pinecone, enabling semantic search capabilities. The application focuses on ingesting cases with valid "Inhoudsindicatie" (official summaries) and uses a PostgreSQL database for duplicate tracking, ensuring data quality and preventing redundant processing across different namespaces. Key features include an AI enrichment pipeline with real-time Pinecone uploads, automatic saving and restoration of fetched records, and advanced ECLI discovery mechanisms.

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
    - **Namespaces**: `WEB_ECLI`, `ECLI_NL`.

- **PostgreSQL (Neon)**:
    - Used for duplicate tracking and batch management.

- **Serper.dev API**:
    - Used for web search ECLI discovery.