import { useState, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  BookOpen, 
  ArrowLeft, 
  Search, 
  Download, 
  Loader2, 
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  FileWarning
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface BwbRegulation {
  bwbId: string;
  title: string;
  lawType?: string;
  publisher?: string;
  dateModified?: string;
  isSelected?: boolean;
  isUploaded?: boolean;
  uploadedAt?: string;
  chunkCount?: number;
}

interface DownloadProgress {
  type: string;
  message: string;
  bwbId?: string;
  chunkCount?: number;
  current?: number;
  total?: number;
  results?: any[];
  errors?: any[];
  totalChunks?: number;
}

interface SearchResponse {
  regulations: BwbRegulation[];
  totalRecords: number;
  startRecord: number;
  maxRecords: number;
}

export default function Wetgeving() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("*");
  const [clientFilter, setClientFilter] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [currentOnly, setCurrentOnly] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [downloadLogs, setDownloadLogs] = useState<string[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const pageSize = 50;

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('nl-NL');
    setDownloadLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const { data, isLoading, refetch } = useQuery<SearchResponse>({
    queryKey: ['/api/wetgeving/search', activeQuery, currentPage],
    queryFn: async () => {
      const startRecord = (currentPage - 1) * pageSize + 1;
      const params = new URLSearchParams({
        query: activeQuery,
        startRecord: startRecord.toString(),
        maxRecords: pageSize.toString(),
      });
      const response = await fetch(`/api/wetgeving/search?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Fout bij ophalen regelingen');
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const regulations = data?.regulations || [];
  const totalRecords = data?.totalRecords || 0;
  const totalPages = Math.ceil(totalRecords / pageSize);

  const handleSearch = () => {
    setActiveQuery(searchQuery || '*');
    setCurrentPage(1);
    setSelectedIds(new Set());
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedIds(new Set());
  };

  const toggleSelection = (bwbId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(bwbId)) {
        next.delete(bwbId);
      } else {
        next.add(bwbId);
      }
      return next;
    });
  };

  const selectAll = () => {
    const newIds = new Set<string>();
    filteredRegulations.forEach(reg => {
      if (!reg.isUploaded) {
        newIds.add(reg.bwbId);
      }
    });
    setSelectedIds(newIds);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const filteredRegulations = regulations.filter(reg => {
    if (!clientFilter) return true;
    const search = clientFilter.toLowerCase();
    return reg.bwbId.toLowerCase().includes(search) || 
           reg.title.toLowerCase().includes(search);
  });

  const selectedCount = selectedIds.size;
  const uploadedCount = filteredRegulations.filter(r => r.isUploaded).length;

  const handleDownload = async () => {
    const selectedBwbIds = Array.from(selectedIds);
    
    if (selectedBwbIds.length === 0) {
      toast({
        title: 'Geen selectie',
        description: 'Selecteer eerst regelingen om te downloaden',
        variant: 'destructive',
      });
      return;
    }

    setIsDownloading(true);
    setDownloadLogs([]);
    setDownloadProgress(null);
    
    addLog(`Controleren op duplicaten voor ${selectedBwbIds.length} regelingen...`);
    
    let bwbIdsToProcess = selectedBwbIds;
    
    try {
      const checkResponse = await apiRequest('/api/wetgeving/check-duplicates', {
        method: 'POST',
        body: JSON.stringify({ bwbIds: selectedBwbIds }),
      });
      
      const checkData = await checkResponse.json();
      
      if (checkData.uploaded > 0) {
        addLog(`${checkData.uploaded} regelingen al geüpload, worden overgeslagen`);
        bwbIdsToProcess = checkData.statuses
          .filter((s: any) => !s.isUploaded)
          .map((s: any) => s.bwbId);
        
        if (bwbIdsToProcess.length === 0) {
          toast({
            title: 'Alle regelingen al geüpload',
            description: `${checkData.uploaded} regelingen zijn al in Pinecone aanwezig`,
          });
          setIsDownloading(false);
          return;
        }
      }
    } catch (error: any) {
      console.error('Duplicate check error:', error);
      addLog(`Waarschuwing: duplicate check mislukt, alle IDs worden verwerkt`);
    }
    
    addLog(`Download gestart voor ${bwbIdsToProcess.length} nieuwe regelingen...`);

    try {
      const response = await fetch('/api/wetgeving/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bwbIds: bwbIdsToProcess,
          currentOnly,
        }),
      });

      if (!response.ok && !response.body) {
        throw new Error('Server retourneerde een fout');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Geen response stream beschikbaar');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const progressData: DownloadProgress = JSON.parse(line.slice(6));
              setDownloadProgress(progressData);
              addLog(progressData.message);

              if (progressData.type === 'complete') {
                toast({
                  title: 'Download voltooid',
                  description: `${progressData.results?.length || 0} regelingen geüpload (${progressData.totalChunks || 0} chunks)`,
                });
                
                setSelectedIds(new Set());
                queryClient.invalidateQueries({ queryKey: ['/api/wetgeving/search'] });
              }
              
              if (progressData.type === 'error' && !progressData.bwbId) {
                toast({
                  title: 'Download fout',
                  description: progressData.message,
                  variant: 'destructive',
                });
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Download error:', error);
      addLog(`Fout: ${error.message}`);
      toast({
        title: 'Download mislukt',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card h-16 flex items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-home" title="Terug naar startpagina">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg md:text-2xl font-medium flex items-center gap-2">
              <BookOpen className="h-6 w-6" />
              Wetgeving Uploaden
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              BWB Regelingen → Pinecone Vector Opslag
            </p>
          </div>
        </div>
        <Badge variant="secondary" data-testid="badge-total-count">
          {totalRecords.toLocaleString()} regelingen
        </Badge>
      </header>

      <main className="container mx-auto p-4 md:p-6 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Zoeken in BWB Regelingen</CardTitle>
            <CardDescription>
              Doorzoek het Basis Wetten Bestand via KOOP/overheid.nl
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="Zoekterm (bijv. 'Burgerlijk Wetboek' of 'BWBR0001840')"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  data-testid="input-search-query"
                />
              </div>
              <Button 
                onClick={handleSearch} 
                disabled={isLoading}
                data-testid="button-search"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="ml-2 hidden md:inline">Zoeken</span>
              </Button>
              <Button 
                variant="outline"
                onClick={() => refetch()}
                disabled={isLoading}
                data-testid="button-refresh"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="currentOnly" 
                  checked={currentOnly}
                  onCheckedChange={(checked) => setCurrentOnly(!!checked)}
                  data-testid="checkbox-current-only"
                />
                <label htmlFor="currentOnly" className="text-sm cursor-pointer">
                  Alleen huidige geldige versie downloaden
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-lg">Regelingen</CardTitle>
                <CardDescription>
                  {selectedCount} geselecteerd · {uploadedCount} al geüpload
                </CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={selectAll} 
                  data-testid="button-select-all"
                  disabled={isDownloading}
                >
                  Selecteer nieuw
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={deselectAll} 
                  data-testid="button-deselect-all"
                  disabled={isDownloading}
                >
                  Deselecteer alles
                </Button>
                <Button 
                  onClick={handleDownload}
                  disabled={isDownloading || selectedCount === 0}
                  data-testid="button-download"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download ({selectedCount})
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Input
                placeholder="Filter in huidige resultaten..."
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                data-testid="input-client-filter"
                className="max-w-sm"
              />
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredRegulations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground" data-testid="empty-state">
                <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Geen regelingen gevonden</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {filteredRegulations.map((reg) => (
                    <div
                      key={reg.bwbId}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        selectedIds.has(reg.bwbId) ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted/50'
                      } ${reg.isUploaded ? 'opacity-60' : ''}`}
                      data-testid={`regulation-item-${reg.bwbId}`}
                    >
                      <Checkbox
                        checked={selectedIds.has(reg.bwbId)}
                        onCheckedChange={() => toggleSelection(reg.bwbId)}
                        disabled={isDownloading}
                        data-testid={`checkbox-regulation-${reg.bwbId}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span 
                            className="font-mono text-sm text-primary"
                            data-testid={`text-bwbid-${reg.bwbId}`}
                          >
                            {reg.bwbId}
                          </span>
                          {reg.lawType && (
                            <Badge variant="outline" className="text-xs">
                              {reg.lawType}
                            </Badge>
                          )}
                          {reg.isUploaded && (
                            <Badge 
                              variant="secondary" 
                              className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              data-testid={`badge-uploaded-${reg.bwbId}`}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Geüpload {reg.chunkCount ? `(${reg.chunkCount} chunks)` : ''}
                            </Badge>
                          )}
                        </div>
                        <p 
                          className="text-sm mt-1 line-clamp-2"
                          data-testid={`text-title-${reg.bwbId}`}
                        >
                          {reg.title}
                        </p>
                        {reg.dateModified && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Laatst gewijzigd: {reg.dateModified}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground" data-testid="text-pagination-info">
                  Pagina {currentPage} van {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage <= 1 || isLoading}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages || isLoading}
                    data-testid="button-next-page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {(isDownloading || downloadLogs.length > 0) && (
          <Card data-testid="card-download-progress">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                {isDownloading && <Loader2 className="h-5 w-5 animate-spin" />}
                Download Voortgang
              </CardTitle>
              {downloadProgress && downloadProgress.current && downloadProgress.total && (
                <CardDescription data-testid="text-progress-count">
                  {downloadProgress.current} / {downloadProgress.total} regelingen
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[200px] bg-muted/30 rounded-lg p-3">
                <div className="space-y-1 font-mono text-xs">
                  {downloadLogs.map((log, i) => (
                    <div 
                      key={i} 
                      className={`${
                        log.includes('Fout') || log.includes('error') 
                          ? 'text-red-600 dark:text-red-400' 
                          : log.includes('geüpload') || log.includes('voltooid')
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-muted-foreground'
                      }`}
                      data-testid={`text-log-${i}`}
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
