import PineconeExport from '../PineconeExport';

const mockLogs = [
  "[2024-01-15 14:32:15] Starting export to Pinecone...",
  "[2024-01-15 14:32:15] Index host: my-index-abc123.svc.apw5-4e34-81fa.pinecone.io",
  "[2024-01-15 14:32:15] Namespace: rechtspraak-decisions",
  "[2024-01-15 14:32:16] Batch 1/3: Uploading records 1-100...",
  "[2024-01-15 14:32:18] Batch 1/3: ✓ Successfully uploaded 100 records",
  "[2024-01-15 14:32:18] Batch 2/3: Uploading records 101-200...",
  "[2024-01-15 14:32:20] Batch 2/3: ✓ Successfully uploaded 100 records",
];

export default function PineconeExportExample() {
  return (
    <PineconeExport
      recordCount={245}
      onExport={(config) => console.log('Export triggered with config:', config)}
      isExporting={false}
      exportLogs={mockLogs}
    />
  );
}
