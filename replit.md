# Rechtspraak Ingestie Tool

## Overview

This project is a web application designed to retrieve and process Dutch judicial rulings from the Rechtspraak.nl Open Data API. Its primary purpose is to extract full-text content, apply quality filters, and prepare this data for storage as vector records in Pinecone, enabling semantic search capabilities. The application focuses on ingesting cases with valid "Inhoudsindicatie" (official summaries) and uses a PostgreSQL database for duplicate tracking, ensuring data quality and preventing redundant processing across different namespaces.

## User Preferences

- All text and UI elements should be in Dutch.
- I prefer clear, concise explanations and direct interaction.
- I appreciate real-time progress feedback, especially for long-running operations.
- I want the tool to prioritize data quality, specifically by filtering out records without valid summaries.
- The system should prevent duplicate processing of ECLI records.
- I prefer to be informed about the status of operations, including successful and failed attempts.
- Avoid making changes to how the `ECLI_NL` namespace is handled; it should remain fixed for all records.

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
    - **Pinecone Export**: Uploads metadata records to a hardcoded Pinecone index (`rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io`) within the `ECLI_NL` namespace. Embedding generation uses the `multilingual-e5-large` model.
    - **Chunking Engine (Optional)**: Features an advanced chunking engine with priority-based section detection, heading normalization, and preamble handling. It can automatically split long sections and extracts rich metadata (e.g., civil_domain, case_subtype, outcome, statutes). An experimental LLM-based semantic chunking method (using GPT-4o) with confidence tracking and automatic fallback is also available.
- **Concurrency & Rate Limiting**: Implements a 200ms delay between Rechtspraak API requests and a 100ms delay between Pinecone batches to respect API limits.
- **Error Handling**: Includes graceful degradation, detailed error logging in the UI, and retry mechanisms where applicable.

### System Design Choices
- **Duplicate Tracking**: A `processed_eclis` table in PostgreSQL tracks already processed ECLIs based on a composite unique key (namespace, ecli), preventing redundant API calls and uploads.
- **Fixed Pinecone Configuration**: The Pinecone index host and namespace (`ECLI_NL`) are hardcoded for consistency and to simplify deployment.
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
    - **Namespace (Fixed)**: `ECLI_NL`.

- **PostgreSQL (Neon)**:
    - Used for duplicate tracking of processed ECLIs.