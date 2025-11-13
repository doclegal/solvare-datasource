import { useState } from "react";
import Header from "@/components/Header";
import FilterSection, { type FilterParams } from "@/components/FilterSection";
import EcliTable, { type EcliRecord } from "@/components/EcliTable";
import RecordPreparation, { type PreparedRecord } from "@/components/RecordPreparation";
import PineconeExport, { type ExportConfig } from "@/components/PineconeExport";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function Home() {
  // State management
  const [ecliRecords, setEcliRecords] = useState<EcliRecord[]>([]);
  const [preparedRecords, setPreparedRecords] = useState<PreparedRecord[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [isFetchingEcli, setIsFetchingEcli] = useState(false);
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const { toast } = useToast();

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('nl-NL');
    setExportLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const handleFetchDecisions = async (filters: FilterParams) => {
    setIsFetchingEcli(true);
    
    try {
      const response = await apiRequest(
        'POST',
        '/api/rechtspraak/search',
        {
          ...filters,
          from: currentOffset,
        }
      );

      const data = await response.json();
      
      setEcliRecords(prev => [...prev, ...data.records]);
      setTotalResults(data.totalResults);
      setCurrentPage(prev => prev + 1);
      // Update offset for next fetch
      setCurrentOffset(prev => prev + filters.batchSize);
      
      toast({
        title: "Uitspraken opgehaald",
        description: `${data.records.length} uitspraken toegevoegd. Totaal: ${data.totalResults} beschikbaar.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij ophalen",
        description: error.message || "Kon uitspraken niet ophalen",
      });
    } finally {
      setIsFetchingEcli(false);
    }
  };

  const handleResetFilters = () => {
    setEcliRecords([]);
    setPreparedRecords([]);
    setCurrentPage(1);
    setTotalResults(0);
    setCurrentOffset(0);
  };

  const handleLoadMore = async () => {
    // This would need to store the last filter state to reuse
    toast({
      title: "Meer laden",
      description: "Gebruik de 'Volgende' knop om door pagina's te bladeren",
    });
  };

  const handlePrevious = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNext = () => {
    setCurrentPage(currentPage + 1);
  };

  const handleClearEcli = () => {
    setEcliRecords([]);
    setPreparedRecords([]);
    setCurrentPage(1);
    setTotalResults(0);
    setCurrentOffset(0);
  };

  const handleFetchContent = async () => {
    setIsFetchingContent(true);

    try {
      const eclis = ecliRecords.map(r => r.ecli);
      
      const response = await apiRequest(
        'POST',
        '/api/rechtspraak/content',
        { eclis }
      );

      const data = await response.json();
      
      setPreparedRecords(data.records);
      
      toast({
        title: "Inhoud opgehaald",
        description: `${data.successful} van ${data.total} uitspraken succesvol verwerkt.`,
      });
      
      if (data.failed > 0) {
        toast({
          variant: "destructive",
          title: "Enkele fouten",
          description: `${data.failed} uitspraken konden niet worden opgehaald.`,
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij ophalen inhoud",
        description: error.message || "Kon volledige inhoud niet ophalen",
      });
    } finally {
      setIsFetchingContent(false);
    }
  };

  const handleClearRecords = () => {
    setPreparedRecords([]);
    setExportLogs([]);
  };

  const handleExport = async (config: ExportConfig) => {
    setIsExporting(true);
    setExportLogs([]);
    
    addLog('Export naar Pinecone gestart...');
    addLog(`Index host: ${config.indexHost}`);
    addLog(`Namespace: ${config.namespace || '(standaard)'}`);
    addLog(`Batchgrootte: ${config.batchSize}`);
    addLog(`Totaal records: ${preparedRecords.length}`);

    try {
      const response = await fetch('/api/pinecone/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          indexHost: config.indexHost,
          namespace: config.namespace,
          batchSize: config.batchSize,
          records: preparedRecords,
        }),
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
          isLoading={isFetchingEcli}
        />

        <EcliTable
          records={ecliRecords}
          currentPage={currentPage}
          totalResults={totalResults}
          onLoadMore={handleLoadMore}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onClear={handleClearEcli}
          isLoading={isFetchingEcli}
        />

        <RecordPreparation
          ecliCount={ecliRecords.length}
          preparedRecords={preparedRecords}
          onFetchContent={handleFetchContent}
          onClear={handleClearRecords}
          isLoading={isFetchingContent}
        />

        <PineconeExport
          recordCount={preparedRecords.length}
          onExport={handleExport}
          isExporting={isExporting}
          exportLogs={exportLogs}
        />
      </main>
    </div>
  );
}
