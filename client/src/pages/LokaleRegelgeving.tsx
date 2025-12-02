import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  MapPin, 
  ArrowLeft, 
  Search, 
  Download, 
  Loader2, 
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Building2,
  Landmark
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface LocalRegulation {
  regulationId: string;
  title: string;
  jurisdiction: string;
  jurisdictionType?: 'provincie' | 'gemeente';
  regulationType?: string;
  validFrom?: string;
  validTo?: string;
  isCurrentVersion?: boolean;
  isSelected?: boolean;
  isUploaded?: boolean;
  uploadedAt?: string;
  chunkCount?: number;
}

interface DownloadProgress {
  type: string;
  message: string;
  regulationId?: string;
  chunkCount?: number;
  current?: number;
  total?: number;
  results?: any[];
  errors?: any[];
  totalChunks?: number;
}

interface SearchResponse {
  regulations: LocalRegulation[];
  totalRecords: number;
  startRecord: number;
  maxRecords: number;
  provinces?: string[];
}

const DUTCH_PROVINCES = [
  "Drenthe",
  "Flevoland",
  "Friesland",
  "Gelderland",
  "Groningen",
  "Limburg",
  "Noord-Brabant",
  "Noord-Holland",
  "Overijssel",
  "Utrecht",
  "Zeeland",
  "Zuid-Holland"
];

export default function LokaleRegelgeving() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("*");
  const [clientFilter, setClientFilter] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [currentOnly, setCurrentOnly] = useState(true);
  const [jurisdictionType, setJurisdictionType] = useState<'all' | 'provincie' | 'gemeente'>('all');
  const [selectedProvince, setSelectedProvince] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [downloadLogs, setDownloadLogs] = useState<string[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showReuploadDialog, setShowReuploadDialog] = useState(false);
  const [uploadedIdsInSelection, setUploadedIdsInSelection] = useState<string[]>([]);
  const [newIdsInSelection, setNewIdsInSelection] = useState<string[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const pageSize = 50;

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('nl-NL');
    setDownloadLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const { data, isLoading, refetch } = useQuery<SearchResponse>({
    queryKey: ['/api/lokale-regelgeving/search', activeQuery, currentPage, jurisdictionType, selectedProvince, currentOnly],
    queryFn: async () => {
      const startRecord = (currentPage - 1) * pageSize + 1;
      const params = new URLSearchParams({
        query: activeQuery,
        startRecord: startRecord.toString(),
        maxRecords: pageSize.toString(),
        currentOnly: currentOnly.toString(),
      });
      
      if (jurisdictionType !== 'all') {
        params.set('jurisdictionType', jurisdictionType);
      }
      if (selectedProvince) {
        params.set('jurisdiction', selectedProvince);
      }
      
      const response = await fetch(`/api/lokale-regelgeving/search?${params}`);
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
  };

  const toggleSelection = (regulationId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(regulationId)) {
        next.delete(regulationId);
      } else {
        next.add(regulationId);
      }
      return next;
    });
  };

  const selectAllOnPage = () => {
    const newIds = new Set(selectedIds);
    filteredRegulations.forEach(reg => {
      newIds.add(reg.regulationId);
    });
    setSelectedIds(newIds);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const filteredRegulations = regulations.filter(reg => {
    if (!clientFilter) return true;
    const search = clientFilter.toLowerCase();
    return reg.regulationId.toLowerCase().includes(search) || 
           reg.title.toLowerCase().includes(search) ||
           reg.jurisdiction?.toLowerCase().includes(search);
  });

  const selectedCount = selectedIds.size;
  const uploadedCount = filteredRegulations.filter(r => r.isUploaded).length;

  const handleDownload = async () => {
    const selectedRegulationIds = Array.from(selectedIds);
    
    if (selectedRegulationIds.length === 0) {
      toast({
        title: 'Geen selectie',
        description: 'Selecteer eerst regelingen om te downloaden',
        variant: 'destructive',
      });
      return;
    }

    // Check for already uploaded items
    try {
      const checkResponse = await apiRequest('POST', '/api/lokale-regelgeving/check-duplicates', { 
        regulationIds: selectedRegulationIds 
      });
      const checkData = await checkResponse.json();
      
      if (checkData.uploaded > 0) {
        // Store both uploaded IDs and new IDs
        const uploadedIds = checkData.statuses
          .filter((s: any) => s.isUploaded)
          .map((s: any) => s.regulationId);
        const newIds = checkData.statuses
          .filter((s: any) => !s.isUploaded)
          .map((s: any) => s.regulationId);
        setUploadedIdsInSelection(uploadedIds);
        setNewIdsInSelection(newIds);
        setShowReuploadDialog(true);
        return;
      }
    } catch (error: any) {
      console.error('Duplicate check error:', error);
    }
    
    // No duplicates found, proceed with download
    await executeDownload(selectedRegulationIds, false);
  };

  const executeDownload = async (regulationIdsToProcess: string[], forceReupload: boolean) => {
    setIsDownloading(true);
    setDownloadLogs([]);
    setDownloadProgress(null);
    
    addLog(`Download gestart voor ${regulationIdsToProcess.length} regelingen${forceReupload ? ' (inclusief her-upload)' : ''}...`);

    const regulationDataToSend = regulations
      .filter(reg => regulationIdsToProcess.includes(reg.regulationId))
      .map(reg => ({
        regulationId: reg.regulationId,
        title: reg.title,
        jurisdiction: reg.jurisdiction,
        jurisdictionType: reg.jurisdictionType,
        regulationType: reg.regulationType,
        validFrom: reg.validFrom,
        validTo: reg.validTo,
        isCurrentVersion: reg.isCurrentVersion,
      }));

    try {
      const response = await fetch('/api/lokale-regelgeving/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regulationIds: regulationIdsToProcess,
          regulationData: regulationDataToSend,
          currentOnly,
          forceReupload,
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
                queryClient.invalidateQueries({ queryKey: ['/api/lokale-regelgeving/search'] });
              }
              
              if (progressData.type === 'error' && !progressData.regulationId) {
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
              <MapPin className="h-6 w-6" />
              Lokale Regelgeving Uploaden
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              Provinciale & Gemeentelijke Verordeningen → Pinecone
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
            <CardTitle className="text-lg">Zoeken in Decentrale Regelgeving</CardTitle>
            <CardDescription>
              Doorzoek provinciale en gemeentelijke verordeningen via CVDR/overheid.nl
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="Zoekterm (bijv. 'APV' of 'huisvestingsverordening')"
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

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Select
                  value={jurisdictionType}
                  onValueChange={(value: 'all' | 'provincie' | 'gemeente') => {
                    setJurisdictionType(value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[180px]" data-testid="select-jurisdiction-type">
                    <SelectValue placeholder="Type overheid" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle overheden</SelectItem>
                    <SelectItem value="provincie">
                      <span className="flex items-center gap-2">
                        <Landmark className="h-4 w-4" />
                        Provincies
                      </span>
                    </SelectItem>
                    <SelectItem value="gemeente">
                      <span className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Gemeenten
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  value={selectedProvince || "all"}
                  onValueChange={(value) => {
                    setSelectedProvince(value === "all" ? "" : value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[200px]" data-testid="select-province">
                    <SelectValue placeholder="Filter op provincie" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle provincies</SelectItem>
                    {DUTCH_PROVINCES.map(province => (
                      <SelectItem key={province} value={province}>
                        {province}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="currentOnly" 
                  checked={currentOnly}
                  onCheckedChange={(checked) => {
                    setCurrentOnly(!!checked);
                    setCurrentPage(1);
                  }}
                  data-testid="checkbox-current-only"
                />
                <label htmlFor="currentOnly" className="text-sm cursor-pointer">
                  Alleen huidige geldige versies
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
                  onClick={selectAllOnPage} 
                  data-testid="button-select-page"
                  disabled={isDownloading}
                >
                  Selecteer pagina
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={deselectAll} 
                  data-testid="button-deselect-all"
                  disabled={isDownloading}
                >
                  Deselecteer
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
                <p className="text-sm mt-2">Probeer een andere zoekopdracht of filter</p>
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="divide-y">
                  {filteredRegulations.map((reg) => (
                    <div
                      key={reg.regulationId}
                      className={`flex items-center gap-3 py-2 px-1 transition-colors cursor-pointer ${
                        selectedIds.has(reg.regulationId) ? 'bg-primary/5' : 'hover:bg-muted/50'
                      } ${reg.isUploaded ? 'opacity-50' : ''}`}
                      onClick={() => !isDownloading && toggleSelection(reg.regulationId)}
                      data-testid={`regulation-item-${reg.regulationId}`}
                    >
                      <Checkbox
                        checked={selectedIds.has(reg.regulationId)}
                        onCheckedChange={() => toggleSelection(reg.regulationId)}
                        disabled={isDownloading}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`checkbox-regulation-${reg.regulationId}`}
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span 
                          className="text-sm truncate"
                          data-testid={`text-title-${reg.regulationId}`}
                          title={reg.title}
                        >
                          {reg.title}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            {reg.jurisdictionType === 'provincie' ? (
                              <Landmark className="h-3 w-3" />
                            ) : (
                              <Building2 className="h-3 w-3" />
                            )}
                            {reg.jurisdiction}
                          </span>
                          {reg.regulationType && (
                            <Badge variant="outline" className="text-xs py-0 px-1">
                              {reg.regulationType}
                            </Badge>
                          )}
                          <span 
                            className="font-mono opacity-60"
                            data-testid={`text-regid-${reg.regulationId}`}
                          >
                            {reg.regulationId}
                          </span>
                        </div>
                      </div>
                      {reg.isUploaded && (
                        <CheckCircle2 
                          className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" 
                          data-testid={`icon-uploaded-${reg.regulationId}`}
                        />
                      )}
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

      <AlertDialog open={showReuploadDialog} onOpenChange={setShowReuploadDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regelingen opnieuw uploaden?</AlertDialogTitle>
            <AlertDialogDescription>
              {uploadedIdsInSelection.length} van de geselecteerde regelingen zijn al eerder geüpload naar Pinecone.
              {newIdsInSelection.length > 0 && ` Er zijn ook ${newIdsInSelection.length} nieuwe regelingen geselecteerd.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel data-testid="button-cancel-reupload">Annuleren</AlertDialogCancel>
            {newIdsInSelection.length > 0 && (
              <AlertDialogAction 
                data-testid="button-new-only"
                className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
                onClick={() => {
                  setShowReuploadDialog(false);
                  executeDownload(newIdsInSelection, false);
                }}
              >
                Alleen nieuwe ({newIdsInSelection.length})
              </AlertDialogAction>
            )}
            <AlertDialogAction 
              data-testid="button-confirm-reupload"
              onClick={() => {
                setShowReuploadDialog(false);
                executeDownload(Array.from(selectedIds), true);
              }}
            >
              Alles uploaden ({selectedIds.size})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
