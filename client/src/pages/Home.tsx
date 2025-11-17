import { useState, useRef, useEffect } from "react";
import Header from "@/components/Header";
import FilterSection, { type FilterParams } from "@/components/FilterSection";
import RecordPreparation, { type PreparedRecord } from "@/components/RecordPreparation";
import PineconeExport, { type ExportConfig } from "@/components/PineconeExport";
import { EcliDiscovery } from "@/components/EcliDiscovery";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const STORAGE_KEY = 'rechtspraak_prepared_records';

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
  const [isEnrichingWithAI, setIsEnrichingWithAI] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const { toast } = useToast();
  
  // Use refs to prevent race conditions from concurrent fetches
  const accumulatedRecordsRef = useRef<PreparedRecord[]>([]);
  const currentOffsetRef = useRef(0);
  const fetchLockRef = useRef(false);
  const activeFiltersRef = useRef<string | null>(null);

  // Load prepared records from localStorage on mount and check for AI enrichment recovery
  useEffect(() => {
    const loadRecords = async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const records = JSON.parse(stored);
          setPreparedRecords(records);
          accumulatedRecordsRef.current = records;
          setTotalResults(records.length);
          console.log(`[localStorage] Loaded ${records.length} records from storage`);
          
          // Check if we have AI enrichment batch ID saved but records don't have AI summaries
          const enrichmentBatchId = localStorage.getItem('rechtspraak_enrichment_batch_id');
          const hasAISummaries = records.some((r: PreparedRecord) => r.ai_inhoudsindicatie || r.ai_feiten);
          
          if (enrichmentBatchId && !hasAISummaries && records.length > 0) {
            console.log('[AI Recovery] Found enrichment batch ID, attempting recovery:', enrichmentBatchId);
            
            // Try to fetch the enriched batch from server
            try {
              const response = await fetch(`/api/rechtspraak/batch/${enrichmentBatchId}`);
              if (response.ok) {
                const batchData = await response.json();
                if (batchData.batch && batchData.batch.records) {
                  const enrichedRecords = batchData.batch.records;
                  console.log('[AI Recovery] Successfully recovered', enrichedRecords.length, 'enriched records');
                  
                  // Merge enriched records with existing records (preserve all records, update with AI data)
                  const enrichedMap = new Map(enrichedRecords.map((r: PreparedRecord) => [r.ecli, r]));
                  const mergedRecords = records.map((r: PreparedRecord) => {
                    const enriched = enrichedMap.get(r.ecli);
                    return enriched || r; // Use enriched version if available, otherwise keep original
                  });
                  
                  setPreparedRecords(mergedRecords);
                  accumulatedRecordsRef.current = mergedRecords;
                  
                  const enrichedCount = mergedRecords.filter((r: PreparedRecord) => r.ai_inhoudsindicatie).length;
                  toast({
                    title: 'AI Verrijking Hersteld',
                    description: `${enrichedCount} van ${mergedRecords.length} records hebben AI samenvattingen`,
                  });
                }
              } else {
                console.log('[AI Recovery] Batch not found on server, may have expired');
                localStorage.removeItem('rechtspraak_enrichment_batch_id');
              }
            } catch (error) {
              console.error('[AI Recovery] Failed to recover enriched batch:', error);
            }
          }
        }
      } catch (error) {
        console.error('[localStorage] Failed to load records:', error);
      }
    };
    
    loadRecords();
  }, [toast]);

  // Save prepared records to localStorage whenever they change
  useEffect(() => {
    if (preparedRecords.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(preparedRecords));
        console.log(`[localStorage] Saved ${preparedRecords.length} records`);
      } catch (error) {
        console.error('[localStorage] Failed to save records:', error);
      }
    }
  }, [preparedRecords]);

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
        
        // Clear localStorage on filter change
        try {
          localStorage.removeItem(STORAGE_KEY);
          console.log('[Filter change] Cleared localStorage');
        } catch (error) {
          console.error('[Filter change] Failed to clear localStorage:', error);
        }
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
      
      
      // Step 2: Check which ECLIs are already processed
      const eclis = searchData.records.map((r: any) => r.ecli);
      const namespace = 'ECLI_NL'; // Fixed namespace
      
      const checkResponse = await apiRequest(
        'POST',
        '/api/processed-eclis/check',
        { eclis, namespace }
      );
      const checkData = await checkResponse.json();
      
      // Filter out already processed ECLIs
      const eclisToFetch = checkData.newEclis;
      
      if (eclisToFetch.length === 0) {
        toast({
          title: "Alle records al verwerkt",
          description: `Alle ${eclis.length} gevonden records zijn al eerder verwerkt en geüpload naar Pinecone.`,
        });
        fetchLockRef.current = false; // Unlock before return
        return;
      }
      
      // Log duplicate info
      if (checkData.alreadyProcessed > 0) {
        addLog(`${checkData.alreadyProcessed} van ${checkData.total} ECLI's al verwerkt - worden overgeslagen`);
      }
      
      // Step 3: Fetch full content for NEW ECLIs only
      const contentResponse = await apiRequest(
        'POST',
        '/api/rechtspraak/content',
        { eclis: eclisToFetch }
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
      
      // Build toast message with filtering and duplicate info
      let description = `${contentData.successful} nieuwe civiele uitspraken verwerkt.`;
      if (checkData.alreadyProcessed > 0) {
        description += ` ${checkData.alreadyProcessed} al eerder verwerkt (overgeslagen).`;
      }
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
    
    // Clear localStorage
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log('[localStorage] Cleared stored records');
    } catch (error) {
      console.error('[localStorage] Failed to clear records:', error);
    }
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
              
              // Only clear records and mark as processed if upload was successful
              if (data.successCount > 0) {
                // Mark ECLIs as processed in database
                try {
                  const actuallyExportedEclis = chunkedData 
                    ? chunkedData.allChunks.map(c => c.ecli)
                    : preparedRecords.map(r => r.ecli);
                  
                  // Deduplicate ECLI list (chunks may have multiple per ECLI)
                  const uniqueEclis = Array.from(new Set(actuallyExportedEclis));
                  const namespace = config.namespace || 'ECLI_NL';
                  
                  addLog('ECLI\'s markeren als verwerkt...');
                  const markResponse = await apiRequest(
                    'POST',
                    '/api/processed-eclis/mark',
                    { eclis: uniqueEclis, namespace }
                  );
                  const markData = await markResponse.json();
                  addLog(`✓ ${markData.marked} ECLI's gemarkeerd als verwerkt`);
                } catch (error: any) {
                  console.error('Failed to mark ECLIs as processed:', error);
                  addLog(`⚠ Waarschuwing: Kon ECLI's niet markeren als verwerkt - ${error.message}`);
                }
                
                // Clear prepared records and chunks ONLY after successful upload
                setPreparedRecords([]);
                setChunkedData(null);
                accumulatedRecordsRef.current = [];
                
                // Clear localStorage too
                localStorage.removeItem('rechtspraak_prepared_records');
                console.log('[localStorage] Cleared records after successful upload');
                
                addLog('✓ Metadata Records tabel geleegd');
              } else {
                addLog('⚠ Geen records succesvol geüpload - Metadata Records blijven behouden');
              }
              
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

  const handleRecordsDiscovered = (discoveredRecords: PreparedRecord[]) => {
    // Add discovered records to prepared records
    setPreparedRecords(prev => [...prev, ...discoveredRecords]);
    accumulatedRecordsRef.current = [...accumulatedRecordsRef.current, ...discoveredRecords];
    
    addLog(`✓ ${discoveredRecords.length} nieuwe ECLI's toegevoegd via discovery`);
  };

  const handleEnrichWithAI = async () => {
    if (preparedRecords.length === 0) {
      toast({
        title: 'Geen records',
        description: 'Er zijn geen records om te verrijken',
        variant: 'destructive',
      });
      return;
    }

    // Warn if exceeding Pinecone batch limit (96 records for embedding API)
    if (preparedRecords.length > 96) {
      toast({
        title: 'Let op: Pinecone limiet',
        description: `Je hebt ${preparedRecords.length} records geselecteerd. Voor optimale upload naar Pinecone wordt aanbevolen max 96 records tegelijk te verrijken.`,
        variant: 'default',
      });
    }

    setIsEnrichingWithAI(true);
    addLog(`🤖 Start AI enrichment voor ${preparedRecords.length} records...`);

    try {
      const eclis = preparedRecords.map(r => r.ecli);
      
      const response = await fetch('/api/rechtspraak/enrich-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          eclis,
          originalRecords: preparedRecords // Send original records for fallback
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Geen response stream beschikbaar');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('[AI Enrichment] Stream completed');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'complete') {
                console.log('[AI Enrichment] Received completion event with', data.records?.length, 'records');
                
                // Save batch ID for recovery if completion event is lost
                if (data.batchId) {
                  localStorage.setItem('rechtspraak_enrichment_batch_id', data.batchId);
                  console.log('[AI Enrichment] Saved batch ID for recovery:', data.batchId);
                }
                
                // Update prepared records with AI enriched data
                setPreparedRecords(data.records || []);
                accumulatedRecordsRef.current = data.records || [];
                
                addLog(`✓ AI enrichment voltooid: ${data.successful} succesvol, ${data.failed} fouten`);
                
                toast({
                  title: 'AI Enrichment Voltooid',
                  description: `${data.successful} records verrijkt met AI samenvattingen`,
                });
              } else if (data.type === 'error') {
                addLog(`✗ Fout: ${data.message}`);
                throw new Error(data.message || 'AI enrichment fout');
              } else if (data.message) {
                addLog(data.message);
              }
            } catch (e: any) {
              if (e.message && e.message.includes('AI enrichment fout')) {
                throw e; // Re-throw known errors
              }
              console.error('[AI Enrichment] Failed to parse SSE message:', e, 'Line:', line);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('[AI Enrichment] Error:', error);
      addLog(`✗ AI enrichment mislukt: ${error.message}`);
      toast({
        title: 'Fout bij AI Enrichment',
        description: error.message || 'Er is een fout opgetreden',
        variant: 'destructive',
      });
    } finally {
      setIsEnrichingWithAI(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header isConnected={true} />
      
      <main className="flex-1 max-w-7xl w-full mx-auto px-8 py-6 space-y-8">
        <EcliDiscovery onRecordsDiscovered={handleRecordsDiscovered} />
        
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
          onEnrichWithAI={handleEnrichWithAI}
          isLoading={isFetchingContent}
          isPreparingChunks={isPreparingChunks}
          isEnrichingWithAI={isEnrichingWithAI}
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
