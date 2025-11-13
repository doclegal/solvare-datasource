import { useState } from "react";
import Header from "@/components/Header";
import FilterSection, { type FilterParams } from "@/components/FilterSection";
import EcliTable, { type EcliRecord } from "@/components/EcliTable";
import RecordPreparation, { type PreparedRecord } from "@/components/RecordPreparation";
import PineconeExport, { type ExportConfig } from "@/components/PineconeExport";

export default function Home() {
  // State management
  const [ecliRecords, setEcliRecords] = useState<EcliRecord[]>([]);
  const [preparedRecords, setPreparedRecords] = useState<PreparedRecord[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [isFetchingEcli, setIsFetchingEcli] = useState(false);
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState<string[]>([]);

  // TODO: Remove mock functionality - Replace with actual API calls
  const handleFetchDecisions = (filters: FilterParams) => {
    console.log('Fetching decisions with filters:', filters);
    setIsFetchingEcli(true);
    
    // Mock API call
    setTimeout(() => {
      const mockData: EcliRecord[] = [
        {
          ecli: "ECLI:NL:HR:2024:123",
          title: "Hoger beroep tegen vonnis inzake arbeidsovereenkomst",
          court: "Hoge Raad",
          decisionDate: "2024-01-15"
        },
        {
          ecli: "ECLI:NL:RBDHA:2024:456",
          title: "Beslissing op bezwaar WOB-verzoek",
          court: "Rechtbank Den Haag",
          decisionDate: "2024-01-12"
        },
        {
          ecli: "ECLI:NL:GHARL:2024:789",
          title: "Hoger beroep strafzaak witwassen",
          court: "Gerechtshof Arnhem-Leeuwarden",
          decisionDate: "2024-01-10"
        },
        {
          ecli: "ECLI:NL:RBAMS:2024:321",
          title: "Veroordeling inzake belastingfraude",
          court: "Rechtbank Amsterdam",
          decisionDate: "2024-01-08"
        },
        {
          ecli: "ECLI:NL:RBROT:2024:654",
          title: "Bestuursrechtelijke procedure milieuwet",
          court: "Rechtbank Rotterdam",
          decisionDate: "2024-01-05"
        },
      ];
      
      setEcliRecords(prev => [...prev, ...mockData]);
      setTotalResults(156);
      setCurrentPage(1);
      setIsFetchingEcli(false);
    }, 1000);
  };

  const handleResetFilters = () => {
    console.log('Resetting filters');
  };

  const handleLoadMore = () => {
    console.log('Loading more decisions');
    setIsFetchingEcli(true);
    
    // Mock loading more
    setTimeout(() => {
      const moreMockData: EcliRecord[] = [
        {
          ecli: "ECLI:NL:GHSGR:2024:987",
          title: "Hoger beroep civiele zaak contractbreuk",
          court: "Gerechtshof 's-Gravenhage",
          decisionDate: "2024-01-03"
        },
      ];
      setEcliRecords(prev => [...prev, ...moreMockData]);
      setIsFetchingEcli(false);
    }, 1000);
  };

  const handlePrevious = () => {
    console.log('Previous page');
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNext = () => {
    console.log('Next page');
    setCurrentPage(currentPage + 1);
  };

  const handleClearEcli = () => {
    console.log('Clearing ECLI list');
    setEcliRecords([]);
    setCurrentPage(1);
    setTotalResults(0);
  };

  const handleFetchContent = () => {
    console.log('Fetching full content for ECLI records');
    setIsFetchingContent(true);

    // Mock API call to fetch full content
    setTimeout(() => {
      const mockPrepared: PreparedRecord[] = ecliRecords.map(record => ({
        ...record,
        legalArea: ["Civiel recht", "Arbeidsrecht"],
        procedureType: "Hoger beroep",
        sourceUrl: `https://uitspraken.rechtspraak.nl/details?id=${record.ecli}`,
        fullText: `De ${record.court} heeft op ${record.decisionDate} recht gedaan in de zaak betreffende ${record.title}. Na afweging van alle feiten en omstandigheden, en gelet op de toepasselijke wetgeving, komt het hof tot de volgende overwegingen en beslissingen... [volledige tekst van de uitspraak met alle overwegingen en rechtsgronden]`
      }));
      
      setPreparedRecords(mockPrepared);
      setIsFetchingContent(false);
    }, 2000);
  };

  const handleClearRecords = () => {
    console.log('Clearing prepared records');
    setPreparedRecords([]);
  };

  const handleExport = (config: ExportConfig) => {
    console.log('Exporting to Pinecone with config:', config);
    setIsExporting(true);
    setExportLogs([]);

    // Mock export process
    const logs: string[] = [];
    const addLog = (message: string) => {
      const timestamp = new Date().toLocaleString('nl-NL');
      logs.push(`[${timestamp}] ${message}`);
      setExportLogs([...logs]);
    };

    addLog('Starting export to Pinecone...');
    addLog(`Index host: ${config.indexHost}`);
    addLog(`Namespace: ${config.namespace || '(default)'}`);
    
    const totalBatches = Math.ceil(preparedRecords.length / config.batchSize);
    
    let currentBatch = 0;
    const interval = setInterval(() => {
      currentBatch++;
      const start = (currentBatch - 1) * config.batchSize + 1;
      const end = Math.min(currentBatch * config.batchSize, preparedRecords.length);
      
      addLog(`Batch ${currentBatch}/${totalBatches}: Uploading records ${start}-${end}...`);
      
      setTimeout(() => {
        addLog(`Batch ${currentBatch}/${totalBatches}: ✓ Successfully uploaded ${end - start + 1} records`);
        
        if (currentBatch >= totalBatches) {
          clearInterval(interval);
          addLog(`✓ Export complete! Total records uploaded: ${preparedRecords.length}`);
          setIsExporting(false);
        }
      }, 500);
    }, 1500);
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
