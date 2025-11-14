import { useState } from "react";
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
  const [chunkedData, setChunkedData] = useState<{ chunksByEcli: Record<string, ChunksByEcli>; allChunks: ChunkedRecord[] } | null>(null);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [isPreparingChunks, setIsPreparingChunks] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const { toast } = useToast();

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('nl-NL');
    setExportLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const handleFetchDecisions = async (filters: FilterParams) => {
    setIsFetchingContent(true);
    
    // Clear chunks when fetching new records
    setChunkedData(null);
    
    try {
      // Step 1: Search for ECLIs
      const searchResponse = await apiRequest(
        'POST',
        '/api/rechtspraak/search',
        {
          ...filters,
          from: currentOffset,
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
      
      setTotalResults(searchData.totalResults);
      
      // Step 2: Immediately fetch full content for found ECLIs
      const eclis = searchData.records.map((r: any) => r.ecli);
      
      const contentResponse = await apiRequest(
        'POST',
        '/api/rechtspraak/content',
        { eclis }
      );

      const contentData = await contentResponse.json();
      
      // Only increment offset after successful content fetch
      setCurrentOffset(prev => prev + filters.batchSize);
      
      // Deduplicate records by ECLI
      setPreparedRecords(prev => {
        const existingEclis = new Set(prev.map(r => r.ecli));
        const newRecords = contentData.records.filter((r: PreparedRecord) => !existingEclis.has(r.ecli));
        return [...prev, ...newRecords];
      });
      
      toast({
        title: "Uitspraken opgehaald",
        description: `${contentData.successful} van ${searchData.records.length} uitspraken succesvol verwerkt. ${searchData.totalResults} totaal beschikbaar.`,
      });
      
      if (contentData.failed > 0) {
        toast({
          variant: "destructive",
          title: "Enkele fouten",
          description: `${contentData.failed} uitspraken konden niet worden opgehaald.`,
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij ophalen",
        description: error.message || "Kon uitspraken niet ophalen",
      });
      // Don't increment offset on error - user can retry the same batch
    } finally {
      setIsFetchingContent(false);
    }
  };

  const handleResetFilters = () => {
    setPreparedRecords([]);
    setChunkedData(null);
    setTotalResults(0);
    setCurrentOffset(0);
  };

  const handleClearRecords = () => {
    setPreparedRecords([]);
    setChunkedData(null);
    setExportLogs([]);
  };

  const handlePrepareChunks = async () => {
    setIsPreparingChunks(true);
    
    try {
      const response = await apiRequest(
        'POST',
        '/api/rechtspraak/prepare-chunks',
        { records: preparedRecords }
      );

      const data = await response.json();
      
      setChunkedData({
        chunksByEcli: data.chunksByEcli,
        allChunks: data.allChunks,
      });
      
      toast({
        title: "Chunks voorbereid",
        description: `${data.totalChunks} chunks gemaakt voor ${data.totalRecords} uitspraken.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij voorbereiden",
        description: error.message || "Kon chunks niet voorbereiden",
      });
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
          onExport={handleExport}
          isExporting={isExporting}
          exportLogs={exportLogs}
        />
      </main>
    </div>
  );
}
