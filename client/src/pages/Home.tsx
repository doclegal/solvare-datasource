import { useState, useRef } from "react";
import Header from "@/components/Header";
import FilterSection, { type FilterParams } from "@/components/FilterSection";
import RecordPreparation, { type PreparedRecord } from "@/components/RecordPreparation";
import PineconeExport, { type ExportConfig } from "@/components/PineconeExport";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ChunkedRecord {
  ecli: string;
  chunk_id: string;
  section_type: string;
  title: string;
  text: string;
  [key: string]: any;
}

interface ChunksByEcli {
  ecli: string;
  title: string;
  totalChunks: number;
  sectionCounts: Record<string, number>;
  chunks: ChunkedRecord[];
}

export default function Home() {
  // State management
  const [preparedRecords, setPreparedRecords] = useState<PreparedRecord[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [chunkedData, setChunkedData] = useState<{ chunksByEcli: Record<string, ChunksByEcli>; allChunks: ChunkedRecord[] } | null>(null);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [currentCivilSubcategory, setCurrentCivilSubcategory] = useState<string>("all");
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [isPreparingChunks, setIsPreparingChunks] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const { toast } = useToast();
  
  // Use refs to prevent race conditions from concurrent fetches
  const accumulatedRecordsRef = useRef<PreparedRecord[]>([]);
  const currentOffsetRef = useRef(0);
  const fetchLockRef = useRef(false);
  const activeFiltersRef = useRef<string | null>(null);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('nl-NL');
    setExportLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const handleFetchDecisions = async (filters: FilterParams) => {
    // Atomic lock acquisition (prevents overlapping invocations)
    const acquireLock = () => {
      if (fetchLockRef.current) return false;
      fetchLockRef.current = true;
      return true;
    };
    
    if (!acquireLock()) {
      console.log('[Fetch guard] Request ignored - fetch already in progress');
      return;
    }
    
    setIsFetchingContent(true);
    
    // Track current civil subcategory for namespace generation
    setCurrentCivilSubcategory(filters.civilSubcategory);
    
    try {
      // Detect filter changes and reset accumulation
      const serializedFilters = JSON.stringify(filters);
      if (activeFiltersRef.current !== serializedFilters) {
        console.log('[Filter change] Resetting accumulation');
        
        // Delete server-side batch if exists
        if (batchId) {
          try {
            await apiRequest('DELETE', `/api/rechtspraak/batch/${batchId}`);
            console.log(`[Filter change] Deleted server batch ${batchId}`);
          } catch (err) {
            console.warn('[Filter change] Failed to delete batch:', err);
          }
        }
        
        // Clear client state
        accumulatedRecordsRef.current = [];
        currentOffsetRef.current = 0;
        setBatchId(null);
        setChunkedData(null);
        setPreparedRecords([]);
        setCurrentOffset(0);
        setTotalResults(0);
        setExportLogs([]);
        activeFiltersRef.current = serializedFilters;
      }
      
      // Clear chunks when fetching new records
      setChunkedData(null);
      
      // Use ref for current offset (atomic)
      const offsetToUse = currentOffsetRef.current;
      
      // Step 1: Search for ECLIs
      const searchResponse = await apiRequest(
        'POST',
        '/api/rechtspraak/search',
        {
          ...filters,
          from: offsetToUse,
        }
      );

      const searchData = await searchResponse.json();
      
      if (searchData.records.length === 0) {
        toast({
          title: "Geen resultaten",
          description: "Geen uitspraken gevonden met deze filters.",
        });
        return;
      }
      
      
      // Step 2: Immediately fetch full content for found ECLIs
      const eclis = searchData.records.map((r: any) => r.ecli);
      
      const contentResponse = await apiRequest(
        'POST',
        '/api/rechtspraak/content',
        { eclis }
      );

      const contentData = await contentResponse.json();
      
      // Deduplicate and accumulate records
      const existingEclis = new Set(accumulatedRecordsRef.current.map(r => r.ecli));
      const newRecords = contentData.records.filter((r: PreparedRecord) => !existingEclis.has(r.ecli));
      
      // Only advance offset if we got new unique records (prevents pagination corruption)
      if (newRecords.length > 0) {
        const accumulatedRecords = [...accumulatedRecordsRef.current, ...newRecords];
        
        // Update refs atomically
        accumulatedRecordsRef.current = accumulatedRecords;
        const nextOffset = currentOffsetRef.current + filters.batchSize;
        currentOffsetRef.current = nextOffset;
        
        // Update state for UI
        setPreparedRecords(accumulatedRecords);
        setCurrentOffset(nextOffset);
        
        // Update totalResults to reflect actual accumulated unique records
        setTotalResults(accumulatedRecords.length);
        
        // Create or update batch with ALL accumulated records
        const batchResponse = await apiRequest(
          'POST',
          '/api/rechtspraak/create-batch',
          { 
            records: accumulatedRecords,
            batchId: batchId || undefined,
          }
        );
        const batchData = await batchResponse.json();
        setBatchId(batchData.batchId);
      } else {
        console.log('[Fetch] No new unique records, offset not advanced');
      }
      
      // Build toast message with filtering info
      let description = `${contentData.successful} civiele uitspraken succesvol verwerkt.`;
      if (contentData.filtered && contentData.filtered > 0) {
        description += ` ${contentData.filtered} niet-civiele ${contentData.filtered === 1 ? 'uitspraak' : 'uitspraken'} uitgefilterd.`;
      }
      if (contentData.failed > 0) {
        description += ` ${contentData.failed} ${contentData.failed === 1 ? 'fout' : 'fouten'}.`;
      }
      description += ` ${searchData.totalResults} totaal beschikbaar.`;
      
      toast({
        title: "Uitspraken opgehaald",
        description,
        variant: contentData.failed > 0 ? "destructive" : "default",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij ophalen",
        description: error.message || "Kon uitspraken niet ophalen",
      });
      // Don't increment offset on error - user can retry the same batch
    } finally {
      setIsFetchingContent(false);
      fetchLockRef.current = false;
    }
  };

  const handleResetFilters = () => {
    setPreparedRecords([]);
    accumulatedRecordsRef.current = [];
    currentOffsetRef.current = 0;
    fetchLockRef.current = false;
    activeFiltersRef.current = null;
    setBatchId(null);
    setChunkedData(null);
    setTotalResults(0);
    setCurrentOffset(0);
  };

  const handleClearRecords = () => {
    setPreparedRecords([]);
    accumulatedRecordsRef.current = [];
    currentOffsetRef.current = 0;
    fetchLockRef.current = false;
    setBatchId(null);
    setChunkedData(null);
    setExportLogs([]);
  };

  const handlePrepareChunks = async (useLLM: boolean = false) => {
    if (!batchId) {
      toast({
        variant: "destructive",
        title: "Geen batch beschikbaar",
        description: "Haal eerst uitspraken op voordat je chunks voorbereidt.",
      });
      return;
    }
    
    setIsPreparingChunks(true);
    
    try {
      const endpoint = useLLM 
        ? '/api/rechtspraak/prepare-chunks-llm'
        : '/api/rechtspraak/prepare-chunks';
      
      const response = await apiRequest(
        'POST',
        endpoint,
        { batchId }
      );

      const data = await response.json();
      
      // Handle both keyword chunking (with chunksByEcli) and LLM chunking (flat chunks array)
      if (useLLM) {
        // LLM endpoint returns flat chunks array, need to group by ECLI
        const chunksByEcli: Record<string, any> = {};
        data.chunks.forEach((chunk: any) => {
          if (!chunksByEcli[chunk.ecli]) {
            chunksByEcli[chunk.ecli] = {
              ecli: chunk.ecli,
              title: chunk.title,
              totalChunks: 0,
              sectionCounts: {},
              chunks: [],
            };
          }
          
          chunksByEcli[chunk.ecli].totalChunks++;
          chunksByEcli[chunk.ecli].sectionCounts[chunk.section_type] = 
            (chunksByEcli[chunk.ecli].sectionCounts[chunk.section_type] || 0) + 1;
          chunksByEcli[chunk.ecli].chunks.push(chunk);
        });
        
        setChunkedData({
          chunksByEcli,
          allChunks: data.chunks,
        });
        
        const fallbackMsg = data.fallbackCount > 0 
          ? ` (${data.fallbackCount} uitspraken gebruikten fallback naar keyword methode)` 
          : '';
        
        toast({
          title: "AI Chunks voorbereid",
          description: `${data.totalChunks} chunks gemaakt voor ${data.totalRecords} uitspraken${fallbackMsg}.`,
        });
      } else {
        setChunkedData({
          chunksByEcli: data.chunksByEcli,
          allChunks: data.allChunks,
        });
        
        toast({
          title: "Chunks voorbereid",
          description: `${data.totalChunks} chunks gemaakt voor ${data.totalRecords} uitspraken.`,
        });
      }
    } catch (error: any) {
      // Handle 404 from stale batchId (e.g., after server restart)
      if (error.message && error.message.includes('404')) {
        // Clear all state to allow fresh refetch
        setBatchId(null);
        setPreparedRecords([]);
        accumulatedRecordsRef.current = [];
        currentOffsetRef.current = 0;
        toast({
          variant: "destructive",
          title: "Batch niet gevonden",
          description: "Batch is verlopen. Gebruik 'Opnieuw' om uitspraken opnieuw op te halen.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Fout bij voorbereiden",
          description: error.message || "Kon chunks niet voorbereiden",
        });
      }
    } finally {
      setIsPreparingChunks(false);
    }
  };

  const handleExport = async (config: ExportConfig) => {
    setIsExporting(true);
    setExportLogs([]);
    
    // Use chunks if available, otherwise use full records
    const dataToExport = chunkedData?.allChunks || preparedRecords;
    const exportType = chunkedData ? 'chunks' : 'records';
    
    addLog('Export naar Pinecone gestart...');
    addLog(`Type: ${chunkedData ? 'Chunks (intelligent sections)' : 'Full records'}`);
    addLog(`Index host: ${config.indexHost}`);
    addLog(`Namespace: ${config.namespace || '(standaard)'}`);
    addLog(`Batchgrootte: ${config.batchSize}`);
    addLog(`Totaal ${exportType}: ${dataToExport.length}`);

    try {
      const exportPayload: any = {
        indexHost: config.indexHost,
        namespace: config.namespace,
        batchSize: config.batchSize,
      };
      
      if (chunkedData) {
        exportPayload.chunks = chunkedData.allChunks;
      } else {
        exportPayload.records = preparedRecords;
      }
      
      const response = await fetch('/api/pinecone/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(exportPayload),
      });

      if (!response.ok) {
        throw new Error('Export mislukt');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Kan response niet lezen');
      }

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'progress') {
              addLog(`Batch verwerkt: ${data.processedRecords}/${data.totalRecords} records (${data.successCount} succesvol, ${data.errorCount} fouten)`);
            } else if (data.type === 'complete') {
              addLog(`✓ Export voltooid! ${data.successCount} records succesvol geüpload.`);
              
              toast({
                title: "Export voltooid",
                description: `${data.successCount} van ${data.totalRecords} records succesvol naar Pinecone verstuurd.`,
              });
              
              if (data.errorCount > 0) {
                toast({
                  variant: "destructive",
                  title: "Enkele fouten",
                  description: `${data.errorCount} records konden niet worden geüpload.`,
                });
              }
            } else if (data.type === 'error') {
              addLog(`✗ Fout: ${data.error}`);
              throw new Error(data.error);
            }
          }
        }
      }
    } catch (error: any) {
      addLog(`✗ Export mislukt: ${error.message}`);
      toast({
        variant: "destructive",
        title: "Export mislukt",
        description: error.message || "Kon niet exporteren naar Pinecone",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header isConnected={true} />
      
      <main className="flex-1 max-w-7xl w-full mx-auto px-8 py-6 space-y-8">
        <FilterSection
          onFetch={handleFetchDecisions}
          onReset={handleResetFilters}
          isLoading={isFetchingContent}
        />

        <RecordPreparation
          ecliCount={preparedRecords.length}
          preparedRecords={preparedRecords}
          chunkedData={chunkedData}
          onPrepareChunks={handlePrepareChunks}
          onFetchContent={() => {}}
          onClear={handleClearRecords}
          isLoading={isFetchingContent}
          isPreparingChunks={isPreparingChunks}
        />

        <PineconeExport
          recordCount={chunkedData?.allChunks?.length || preparedRecords.length}
          isChunked={!!chunkedData}
          civilSubcategory={currentCivilSubcategory}
          onExport={handleExport}
          isExporting={isExporting}
          exportLogs={exportLogs}
        />
      </main>
    </div>
  );
}
