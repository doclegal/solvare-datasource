import { useState, useRef } from "react";
import Header from "@/components/Header";
import FilterSection, { type FilterParams } from "@/components/FilterSection";
import RecordPreparation, { type PreparedRecord } from "@/components/RecordPreparation";
import PineconeExport, { type ExportConfig } from "@/components/PineconeExport";
import WebSearchDiscovery from "@/components/WebSearchDiscovery";
import BatchManager from "@/components/BatchManager";
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
      // API search results always go to ECLI_NL namespace
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

  const handleResumeBatch = async (batchId: string, records: PreparedRecord[]) => {
    // Load the batch records into the current state
    setPreparedRecords(records);
    
    const enrichedCount = countEnrichedRecords(records);
    const remainingCount = records.length - enrichedCount;
    
    addLog(`📋 Batch geladen: ${records.length} records (${enrichedCount} verrijkt, ${remainingCount} te verrijken)`);
    
    // Automatically start enrichment with resume
    setTimeout(() => {
      handleEnrichWithAI(batchId);
    }, 500); // Small delay to ensure UI updates
  };

  const handleEnrichWithAI = async (resumeBatchId?: string) => {
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
      if (resumeBatchId) {
        addLog(`AI enrichment hervatten voor batch ${resumeBatchId} (${eclis.length} records)...`);
      } else {
        addLog(`AI enrichment starten voor ${eclis.length} records...`);
      }
      
      // Strip circular references and problematic fields from preparedRecords
      const cleanRecords = preparedRecords.map(record => ({
        ecli: record.ecli,
        title: record.title,
        court: record.court,
        decisionDate: record.decisionDate,
        legalArea: record.legalArea,
        procedureType: record.procedureType,
        inhoudsindicatie: record.inhoudsindicatie,
        source: record.source,
        sourceUrl: record.sourceUrl,
        // Include AI fields if resuming
        ai_title: record.ai_title,
        ai_inhoudsindicatie: record.ai_inhoudsindicatie,
        ai_feiten: record.ai_feiten,
        ai_geschil: record.ai_geschil,
        ai_beslissing: record.ai_beslissing,
        ai_motivering: record.ai_motivering,
      }));
      
      const response = await fetch('/api/rechtspraak/enrich-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          eclis,
          originalRecords: cleanRecords,
          resumeBatchId,
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
      
      // Robust error message extraction - handle all edge cases including DOMException
      let errorMsg = '';
      
      // Check for AbortError (DOMException) - happens when stream ends unexpectedly
      if (error?.name === 'AbortError' || (error?.constructor?.name === 'DOMException' && error?.code === 20)) {
        errorMsg = 'Verbinding met AI enrichment verbroken - mogelijk server error. Controleer de server logs.';
      } else if (typeof error === 'string' && error.trim()) {
        errorMsg = error;
      } else if (error?.message && typeof error.message === 'string' && error.message.trim()) {
        errorMsg = error.message;
      } else if (error instanceof TypeError) {
        errorMsg = 'Netwerkfout - controleer de serververbinding';
      } else if (error instanceof Error) {
        errorMsg = error.toString();
      } else if (error && typeof error === 'object') {
        // Try to extract something useful from the object
        const jsonStr = JSON.stringify(error);
        if (jsonStr !== '{}' && jsonStr !== 'null') {
          errorMsg = jsonStr;
        } else {
          errorMsg = 'Onbekende fout bij AI enrichment - mogelijk stream verbinding probleem';
        }
      }
      
      // Final fallback
      if (!errorMsg || errorMsg.trim() === '') {
        errorMsg = 'Onbekende fout bij AI enrichment - controleer de server logs';
      }
      
      addLog(`✗ AI enrichment mislukt: ${errorMsg}`);
      toast({
        title: 'Fout bij AI Enrichment',
        description: errorMsg,
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
              addLog(`✓ Export voltooid! ${data.totalUpserted} records succesvol geüpload naar ${data.namespaces?.length || 0} namespace(s).`);
              
              // Backend marks processed_eclis automatically per namespace during upload
              // No need to do this manually in frontend anymore
              
              if (data.totalUpserted > 0) {
                // Clear records after successful upload
                setPreparedRecords([]);
                addLog('✓ Records tabel geleegd');
              }
              
              toast({
                title: "Export voltooid",
                description: `${data.totalUpserted} records succesvol naar Pinecone verstuurd.`,
              });
              
              if (data.namespaces && data.namespaces.length > 0) {
                const namespaceSummary = data.namespaces
                  .map((ns: any) => `${ns.namespace}: ${ns.successCount} records`)
                  .join(', ');
                addLog(`📊 Namespace verdeling: ${namespaceSummary}`);
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

  const handleLoadBatch = (records: PreparedRecord[]) => {
    setPreparedRecords(records);
    const enrichedCount = countEnrichedRecords(records);
    toast({
      title: "Batch geladen",
      description: `${records.length} records geladen (${enrichedCount} AI-verrijkt)`,
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header isConnected={true} />
      
      <main className="flex-1 max-w-7xl w-full mx-auto px-8 py-6 space-y-8">
        <WebSearchDiscovery onRecordsDiscovered={handleRecordsDiscovered} />
        
        <FilterSection
          onFetch={handleFetchDecisions}
          onReset={handleResetFilters}
          isLoading={isFetchingContent}
        />

        <BatchManager
          currentRecords={preparedRecords}
          onLoadBatch={handleLoadBatch}
          onResumeBatch={handleResumeBatch}
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
          preparedRecords={preparedRecords}
          onExport={handleExport}
          isExporting={isExporting}
          exportLogs={exportLogs}
        />
      </main>
    </div>
  );
}
