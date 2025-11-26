import { useState, useRef, useEffect } from "react";
import Header from "@/components/Header";
import FilterSection, { type FilterParams } from "@/components/FilterSection";
import RecordPreparation, { type PreparedRecord } from "@/components/RecordPreparation";
import PineconeExport, { type ExportConfig } from "@/components/PineconeExport";
import WebSearchDiscovery from "@/components/WebSearchDiscovery";
import BatchManager from "@/components/BatchManager";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDuplicateCheck } from "@/hooks/useDuplicateCheck";

// ⚙️ FEATURE FLAG: Auto-save batches after fetching records
// Set to false to disable auto-save and restore manual-only behavior
const ENABLE_AUTO_SAVE = true;

export default function Home() {
  // Simple state - no persistence, no batching
  const [preparedRecords, setPreparedRecords] = useState<PreparedRecord[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [currentCivilSubcategory, setCurrentCivilSubcategory] = useState<string>("all");
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [isEnrichingWithAI, setIsEnrichingWithAI] = useState(false);
  const [testingSummary, setTestingSummary] = useState<Record<string, { loading: boolean; summary: string | null; error: string | null }>>({});
  const [enrichAllProgress, setEnrichAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null); // Track current batch for auto-save
  const { toast } = useToast();
  
  const fetchLockRef = useRef(false);
  const autoSaveInProgressRef = useRef(false); // Prevent concurrent auto-saves
  const autoRestoreAttemptedRef = useRef(false); // Track if auto-restore was already attempted
  
  // 🔍 DUPLICATE CHECK: Automatically check if records are already uploaded to Pinecone
  const { records: recordsWithDuplicateStatus, isChecking: isCheckingDuplicates, duplicateCount, newCount } = useDuplicateCheck(preparedRecords);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('nl-NL');
    setExportLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  // 🔄 AUTO-RESTORE: Automatically load the most recent batch on page load
  // This ensures data persistence across page refreshes
  useEffect(() => {
    // Only attempt auto-restore once per page load
    if (!ENABLE_AUTO_SAVE || autoRestoreAttemptedRef.current) {
      return;
    }

    autoRestoreAttemptedRef.current = true;

    const autoRestoreLastBatch = async () => {
      try {
        const response = await apiRequest('GET', '/api/batches/list');
        const data = await response.json();

        if (data.batches && data.batches.length > 0) {
          // Get most recent batch (first in list, sorted by created_at DESC)
          const latestBatch = data.batches[0];

          // Auto-load only if batch is recent (within 24 hours)
          const batchAge = Date.now() - new Date(latestBatch.created_at).getTime();
          const hoursOld = batchAge / (1000 * 60 * 60);

          if (hoursOld < 24) {
            setPreparedRecords(latestBatch.records);
            setCurrentBatchId(latestBatch.id);
            
            const enrichedCount = latestBatch.records.filter((r: PreparedRecord) => r.ai_title).length;
            console.log(`[Auto-restore] Loaded batch ${latestBatch.id.substring(0, 8)}... with ${latestBatch.records.length} records (${enrichedCount} AI-verrijkt)`);
            
            // Silent restore - no toast notification to avoid annoying users
          }
        }
      } catch (error) {
        // Silent fail - auto-restore is a convenience feature, not critical
        console.error('[Auto-restore] Failed to load last batch:', error);
      }
    };

    autoRestoreLastBatch();
  }, []); // Empty deps = run once on mount

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
      
      // Extract only NEW (not yet processed) ECLIs from statuses
      const eclisToFetch = checkData.statuses
        .filter((s: any) => !s.isProcessed)
        .map((s: any) => s.ecli);
      
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
      
      // 💾 AUTO-SAVE: Automatically save to batch storage (if enabled)
      // This happens asynchronously and won't block the UI
      if (contentData.records.length > 0) {
        autoSaveBatch(contentData.records);
      }
      
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

  // 💾 AUTO-SAVE: Automatically save records to batch storage (if enabled)
  // SAFETY: Only auto-saves on FIRST fetch (when currentBatchId is null)
  // Uses ref-based guard to prevent race conditions from concurrent fetches
  const autoSaveBatch = async (records: PreparedRecord[]) => {
    // Only auto-save if:
    // 1. Feature flag is enabled
    // 2. We have records to save
    // 3. No batch exists yet (first fetch only)
    // 4. Not already saving (prevent race condition)
    if (!ENABLE_AUTO_SAVE || records.length === 0 || currentBatchId !== null || autoSaveInProgressRef.current) {
      return;
    }

    autoSaveInProgressRef.current = true; // Set IMMEDIATELY (synchronous)
    
    try {
      const response = await apiRequest('POST', '/api/batches/save', {
        records,
      });

      const data = await response.json();
      setCurrentBatchId(data.batchId);
      
      addLog(`💾 Auto-opgeslagen: ${records.length} records (batch: ${data.batchId.substring(0, 8)}...)`);
    } catch (error: any) {
      // Silent fail - don't interrupt user flow with auto-save errors
      console.error('[Auto-save] Failed to save batch:', error);
      addLog(`⚠️ Auto-opslaan mislukt (records blijven in memory)`);
    } finally {
      autoSaveInProgressRef.current = false; // Clear when done
    }
  };

  const handleResetFilters = () => {
    setPreparedRecords([]);
    setTotalResults(0);
    setExportLogs([]);
    setCurrentBatchId(null); // Clear batch ID on reset
  };

  const handleClearRecords = () => {
    setPreparedRecords([]);
    setExportLogs([]);
    setCurrentBatchId(null); // Clear batch ID on clear
  };

  // Verrijk ALLE records met AI samenvattingen
  const handleEnrichAllRecords = async () => {
    if (preparedRecords.length === 0) {
      toast({
        title: 'Geen records',
        description: 'Er zijn geen records om te verrijken',
        variant: 'destructive',
      });
      return;
    }

    setIsEnrichingWithAI(true);
    setEnrichAllProgress({ current: 0, total: preparedRecords.length });
    
    let successCount = 0;
    let errorCount = 0;

    addLog(`AI verrijking gestart voor ${preparedRecords.length} records...`);

    for (let i = 0; i < preparedRecords.length; i++) {
      const record = preparedRecords[i];
      
      // Skip if already enriched
      if (record.ai_title) {
        addLog(`⏭️ ${record.ecli} al verrijkt, overgeslagen`);
        setEnrichAllProgress({ current: i + 1, total: preparedRecords.length });
        continue;
      }

      try {
        setEnrichAllProgress({ current: i + 1, total: preparedRecords.length });
        addLog(`[${i + 1}/${preparedRecords.length}] Verrijken: ${record.ecli}...`);
        
        await handleTestAISummary(record.ecli);
        successCount++;
        
        // Rate limiting: wacht 1 seconde tussen requests
        if (i < preparedRecords.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error: any) {
        errorCount++;
        addLog(`✗ ${record.ecli}: ${error.message}`);
      }
    }

    setIsEnrichingWithAI(false);
    setEnrichAllProgress(null);

    addLog(`✓ Volttooid: ${successCount} verrijkt, ${errorCount} fouten`);
    
    toast({
      title: 'AI Verrijking voltooid',
      description: `${successCount} records verrijkt, ${errorCount} fouten`,
    });
  };

  // NIEUWE FUNCTIE: Test AI samenvatting voor 1 record + direct upload naar Pinecone
  const handleTestAISummary = async (ecli: string) => {
    setTestingSummary(prev => ({ ...prev, [ecli]: { loading: true, summary: null, error: null } }));
    
    try {
      const rechtspraakUrl = `https://uitspraken.rechtspraak.nl/details?id=${ecli}`;
      
      // Step 1: AI Enrichment
      const response = await fetch('/api/ai/test-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ecli,
          rechtspraakUrl 
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      // Update testingSummary for UI feedback
      setTestingSummary(prev => ({ 
        ...prev, 
        [ecli]: { loading: false, summary: data.summary, error: null } 
      }));
      
      // BELANGRIJK: Create enriched record object FIRST
      // Find the original record from state
      const originalRecord = preparedRecords.find(r => r.ecli === ecli);
      if (!originalRecord) {
        throw new Error(`Record ${ecli} not found in preparedRecords`);
      }
      
      // Create enriched version
      const enrichedRecord: PreparedRecord = {
        ...originalRecord,
        ai_title: data.summary.title,
        ai_inhoudsindicatie: data.summary.inhoudsindicatie,
        ai_feiten: data.summary.feiten,
        ai_geschil: data.summary.geschil,
        ai_beslissing: data.summary.beslissing,
        ai_motivering: data.summary.motivering,
      };
      
      // Update state with enriched record
      setPreparedRecords(prev => prev.map(record => {
        if (record.ecli === ecli) {
          return enrichedRecord;
        }
        return record;
      }));
      
      addLog(`✓ ${ecli} verrijkt met AI samenvatting`);
      
      // Step 2: Direct upload naar Pinecone
      toast({
        title: 'Record wordt geüpload',
        description: `${ecli} wordt nu naar Pinecone verstuurd...`,
      });
      
      await uploadSingleRecordToPinecone(enrichedRecord);
      
    } catch (error: any) {
      setTestingSummary(prev => ({ 
        ...prev, 
        [ecli]: { loading: false, summary: null, error: error.message } 
      }));
      
      addLog(`✗ ${ecli}: ${error.message}`);
      
      toast({
        title: 'Fout bij AI samenvatting',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  // Upload single enriched record to Pinecone immediately
  const uploadSingleRecordToPinecone = async (record: PreparedRecord) => {
    try {
      const indexHost = "rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io";
      
      // Determine namespace based on source
      const namespace = record.source === 'web_search' ? 'WEB_ECLI' : 'ECLI_NL';
      
      addLog(`📤 Uploading ${record.ecli} naar ${namespace}...`);
      
      const response = await fetch('/api/pinecone/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indexHost,
          namespace, // Will be overridden by backend's source-based routing
          records: [record], // Single record array
          batchSize: 1,
          includeNonEnriched: false, // Only enriched records
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: HTTP ${response.status} - ${errorText}`);
      }

      // Read SSE stream for progress
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No response body reader available');
      }
      
      let uploadCompleted = false;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));
              
              if (eventData.type === 'complete') {
                uploadCompleted = true;
                addLog(`✓ ${record.ecli} geüpload naar ${namespace}`);
                toast({
                  title: 'Upload voltooid',
                  description: `${record.ecli} succesvol naar Pinecone (${namespace})`,
                });
              } else if (eventData.type === 'error') {
                throw new Error(eventData.message || 'Upload error');
              }
            } catch (parseError) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }
      
      if (!uploadCompleted) {
        console.warn(`[Upload] Stream ended but no 'complete' event received`);
      }
    } catch (error: any) {
      console.error(`[Upload] Error uploading ${record.ecli}:`, error);
      addLog(`✗ Upload ${record.ecli}: ${error.message}`);
      toast({
        title: 'Upload fout',
        description: `${record.ecli}: ${error.message}`,
        variant: 'destructive',
      });
      throw error; // Re-throw to prevent silent failures
    }
  };

  const handleRecordsDiscovered = (discoveredRecords: PreparedRecord[]) => {
    setPreparedRecords(prev => [...prev, ...discoveredRecords]);
    addLog(`✓ ${discoveredRecords.length} nieuwe ECLI's toegevoegd via discovery`);
    
    // Note: Discovery does NOT auto-save (only first fetch does)
    // User must manually save if they want to persist discovered records
  };

  const countEnrichedRecords = (records: PreparedRecord[]): number => {
    return records.filter(r => 
      r.ai_title || r.ai_inhoudsindicatie || r.ai_feiten || 
      r.ai_geschil || r.ai_beslissing || r.ai_motivering
    ).length;
  };

  const handleResumeBatch = async (batchId: string, records: PreparedRecord[]) => {
    console.log('🟢 Home handleResumeBatch called');
    console.log('🟢 batchId type:', typeof batchId);
    console.log('🟢 batchId value:', batchId);
    console.log('🟢 records type:', typeof records);
    console.log('🟢 records is array:', Array.isArray(records));
    console.log('🟢 records count:', records?.length);
    
    // Load the batch records into the current state
    setPreparedRecords(records);
    
    // CRITICAL: Set currentBatchId to prevent auto-save from creating duplicate batch
    setCurrentBatchId(batchId);
    
    const enrichedCount = countEnrichedRecords(records);
    const remainingCount = records.length - enrichedCount;
    
    addLog(`📋 Batch geladen: ${records.length} records (${enrichedCount} verrijkt, ${remainingCount} te verrijken)`);
    
    // Automatically start enrichment with resume
    console.log('🟢 About to call handleEnrichWithAI with batchId:', batchId);
    setTimeout(() => {
      console.log('🟢 setTimeout executing - calling handleEnrichWithAI');
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

    // Filter out duplicates - only enrich new records
    const recordsToEnrich = preparedRecords.filter(r => !r.isDuplicate);
    
    if (recordsToEnrich.length === 0) {
      toast({
        title: 'Geen nieuwe records',
        description: 'Alle records zijn al geüpload',
        variant: 'destructive',
      });
      addLog('⚠️ Geen nieuwe records om te verrijken (alle records zijn al geüpload)');
      return;
    }

    const duplicateCount = preparedRecords.length - recordsToEnrich.length;
    if (duplicateCount > 0) {
      addLog(`📋 ${duplicateCount} duplicaten overgeslagen, ${recordsToEnrich.length} nieuwe records worden verrijkt`);
    }

    setIsEnrichingWithAI(true);

    try {
      // CLEAN REBUILD: Extract ONLY ECLIs from new records - no complex objects, no circular refs
      const eclis = recordsToEnrich.map(r => r.ecli);
      
      if (resumeBatchId) {
        addLog(`AI enrichment hervatten voor batch ${resumeBatchId} (${eclis.length} records)...`);
      } else {
        addLog(`AI enrichment starten voor ${eclis.length} records...`);
      }
      
      console.log(`[AI Enrich] Calling /api/ai/enrich with ${eclis.length} ECLIs`);
      
      // Call new clean endpoint
      const response = await fetch('/api/ai/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eclis, resumeBatchId }),
      });
      
      console.log('[AI Enrich] Response status:', response.status);
      console.log('[AI Enrich] Response ok:', response.ok);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AI Enrich] Error response:', errorText);
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.error || `HTTP ${response.status}`);
        } catch {
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
      }

      const responseText = await response.text();
      console.log('[AI Enrich] Response text length:', responseText.length);
      console.log('[AI Enrich] Response preview:', responseText.substring(0, 200));
      
      const data = JSON.parse(responseText);
      
      console.log(`[AI Enrich] Received ${data.enrichedRecords.length} enriched records`);
      
      // Update preparedRecords with enriched data
      // Match by ECLI and merge AI fields
      setPreparedRecords(prev => prev.map(record => {
        const enriched = data.enrichedRecords.find((r: PreparedRecord) => r.ecli === record.ecli);
        if (enriched) {
          return {
            ...record,
            ai_title: enriched.ai_title,
            ai_inhoudsindicatie: enriched.ai_inhoudsindicatie,
            ai_feiten: enriched.ai_feiten,
            ai_geschil: enriched.ai_geschil,
            ai_beslissing: enriched.ai_beslissing,
            ai_motivering: enriched.ai_motivering,
          };
        }
        return record;
      }));
      
      // Log results
      addLog(`✓ AI enrichment voltooid: ${data.stats.enriched} verrijkt, ${data.stats.failed} fouten`);
      
      if (data.errors.length > 0) {
        data.errors.forEach((err: { ecli: string; error: string }) => {
          addLog(`✗ ${err.ecli}: ${err.error}`);
        });
      }

      toast({
        title: 'AI Enrichment voltooid',
        description: `${data.stats.enriched} records verrijkt met AI samenvattingen`,
      });
    } catch (error: any) {
      console.error('[AI Enrichment] Error:', error);
      
      addLog(`Fout bij AI enrichment: ${error.message}`);
      toast({
        title: 'AI Enrichment mislukt',
        description: error.message,
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

  const handleLoadBatch = (batchId: string, records: PreparedRecord[]) => {
    setPreparedRecords(records);
    
    // CRITICAL: Set currentBatchId to prevent duplicate auto-saves
    setCurrentBatchId(batchId);
    
    const enrichedCount = countEnrichedRecords(records);
    toast({
      title: "Batch geladen",
      description: `${records.length} records geladen (${enrichedCount} AI-verrijkt)`,
    });
  };

  const handleSaveBatch = (batchId: string) => {
    // CRITICAL: Set currentBatchId when user manually saves to prevent duplicate auto-saves
    setCurrentBatchId(batchId);
    addLog(`💾 Handmatig opgeslagen: batch ${batchId.substring(0, 8)}...`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header isConnected={true} />
      
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-8 py-6 space-y-8">
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
          onSaveBatch={handleSaveBatch}
        />

        <RecordPreparation
          ecliCount={preparedRecords.length}
          preparedRecords={recordsWithDuplicateStatus}
          onFetchContent={() => {}} 
          onClear={handleClearRecords}
          onEnrichAllRecords={handleEnrichAllRecords}
          onTestAISummary={handleTestAISummary}
          testingSummary={testingSummary}
          enrichAllProgress={enrichAllProgress}
          isEnrichingWithAI={isEnrichingWithAI}
          isCheckingDuplicates={isCheckingDuplicates}
          duplicateCount={duplicateCount}
          newCount={newCount}
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
