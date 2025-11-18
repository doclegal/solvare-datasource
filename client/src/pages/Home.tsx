import { useState, useRef } from "react";
import Header from "@/components/Header";
import FilterSection, { type FilterParams } from "@/components/FilterSection";
import RecordPreparation, { type PreparedRecord } from "@/components/RecordPreparation";
import PineconeExport, { type ExportConfig } from "@/components/PineconeExport";
import { EcliDiscovery } from "@/components/EcliDiscovery";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function Home() {
  // Simple state - no persistence, no batching
  const [preparedRecords, setPreparedRecords] = useState<PreparedRecord[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [currentCivilSubcategory, setCurrentCivilSubcategory] = useState<string>("all");
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [isEnrichingWithAI, setIsEnrichingWithAI] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const { toast } = useToast();
  
  const fetchLockRef = useRef(false);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('nl-NL');
    setExportLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const handleFetchDecisions = async (filters: FilterParams) => {
    if (fetchLockRef.current) {
      console.log('[Fetch guard] Already fetching');
      return;
    }
    
    fetchLockRef.current = true;
    setIsFetchingContent(true);
    setCurrentCivilSubcategory(filters.civilSubcategory);
    
    try {
      // Step 1: Search for ECLIs (max 25)
      const searchResponse = await apiRequest(
        'POST',
        '/api/rechtspraak/search',
        {
          ...filters,
          from: 0,
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
      const namespace = 'ECLI_NL';
      
      const checkResponse = await apiRequest(
        'POST',
        '/api/processed-eclis/check',
        { eclis, namespace }
      );
      const checkData = await checkResponse.json();
      
      const eclisToFetch = checkData.newEclis;
      
      if (eclisToFetch.length === 0) {
        toast({
          title: "Alle records al verwerkt",
          description: `Alle ${eclis.length} gevonden records zijn al eerder verwerkt.`,
        });
        return;
      }
      
      if (checkData.alreadyProcessed > 0) {
        addLog(`${checkData.alreadyProcessed} van ${checkData.total} ECLI's al verwerkt - overgeslagen`);
      }
      
      // Step 3: Fetch full content for NEW ECLIs only
      const contentResponse = await apiRequest(
        'POST',
        '/api/rechtspraak/content',
        { eclis: eclisToFetch }
      );

      const contentData = await contentResponse.json();
      
      // Simply set the records
      setPreparedRecords(contentData.records);
      setTotalResults(searchData.total || contentData.records.length);
      
      let description = `${contentData.successful} nieuwe civiele uitspraken opgehaald.`;
      if (checkData.alreadyProcessed > 0) {
        description += ` ${checkData.alreadyProcessed} al verwerkt (overgeslagen).`;
      }
      if (contentData.failed > 0) {
        description += ` ${contentData.failed} fouten.`;
      }
      
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
    } finally {
      setIsFetchingContent(false);
      fetchLockRef.current = false;
    }
  };

  const handleResetFilters = () => {
    setPreparedRecords([]);
    setTotalResults(0);
    setExportLogs([]);
  };

  const handleClearRecords = () => {
    setPreparedRecords([]);
    setExportLogs([]);
  };

  const handleRecordsDiscovered = (discoveredRecords: PreparedRecord[]) => {
    setPreparedRecords(prev => [...prev, ...discoveredRecords]);
    addLog(`✓ ${discoveredRecords.length} nieuwe ECLI's toegevoegd via discovery`);
  };

  const countEnrichedRecords = (records: PreparedRecord[]): number => {
    return records.filter(r => 
      r.ai_title || r.ai_inhoudsindicatie || r.ai_feiten || 
      r.ai_geschil || r.ai_beslissing || r.ai_motivering
    ).length;
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

    setIsEnrichingWithAI(true);
    const eclis = preparedRecords.map(r => r.ecli);

    try {
      addLog(`AI enrichment starten voor ${eclis.length} records...`);
      
      const response = await fetch('/api/rechtspraak/enrich-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          eclis,
          originalRecords: preparedRecords
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
                // Update records with enriched data
                setPreparedRecords(data.records || []);
                
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
                throw e;
              }
              console.error('[AI Enrichment] Parse error:', e);
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

  const handleExport = async (config: ExportConfig) => {
    setIsExporting(true);
    setExportLogs([]);
    addLog('Export naar Pinecone gestart...');

    try {
      const response = await fetch('/api/pinecone/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: preparedRecords,
          ...config,
        }),
      });

      if (!response.body) {
        throw new Error('Geen response stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'progress') {
              addLog(`Batch verwerkt: ${data.processedRecords}/${data.totalRecords} records (${data.successCount} succesvol)`);
            } else if (data.type === 'complete') {
              addLog(`✓ Export voltooid! ${data.successCount} records succesvol geüpload.`);
              
              if (data.successCount > 0) {
                // Mark as processed
                const uniqueEclis = Array.from(new Set(preparedRecords.map(r => r.ecli)));
                const namespace = config.namespace || 'ECLI_NL';
                
                addLog('ECLI\'s markeren als verwerkt...');
                const markResponse = await apiRequest(
                  'POST',
                  '/api/processed-eclis/mark',
                  { eclis: uniqueEclis, namespace }
                );
                const markData = await markResponse.json();
                addLog(`✓ ${markData.marked} ECLI's gemarkeerd als verwerkt`);
                
                // Clear records after successful upload
                setPreparedRecords([]);
                addLog('✓ Records tabel geleegd');
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
          onFetchContent={() => {}} 
          onClear={handleClearRecords}
          onEnrichWithAI={handleEnrichWithAI}
          isEnrichingWithAI={isEnrichingWithAI}
        />

        <PineconeExport
          recordCount={preparedRecords.length}
          enrichedRecordCount={countEnrichedRecords(preparedRecords)}
          onExport={handleExport}
          isExporting={isExporting}
          exportLogs={exportLogs}
        />
      </main>
    </div>
  );
}
