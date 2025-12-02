import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  ArrowLeft, 
  Search, 
  Loader2, 
  AlertCircle,
  Building2,
  FileText,
  ExternalLink,
  Key,
  ChevronLeft,
  ChevronRight,
  Info,
  MapPin
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface DsoRegeling {
  identificatie: string;
  officieleTitel: string;
  citeerTitel?: string;
  type: string;
  bevoegdGezag: {
    code: string;
    naam: string;
  };
  dateStart?: string;
  status?: string;
  publicatiedatum?: string;
  inwerkingtreding?: string;
  documentUrl?: string;
}

interface Municipality {
  code: string;
  name: string;
  province: string;
}

interface DocumentType {
  value: string;
  label: string;
}

interface AuthorityType {
  value: string;
  label: string;
}

interface SearchResponse {
  regelingen: DsoRegeling[];
  totalRecords: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

interface StatusResponse {
  configured: boolean;
  message: string;
}

export default function Omgevingsplannen() {
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>("");
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>("all");
  const [selectedAuthorityType, setSelectedAuthorityType] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast } = useToast();
  
  const pageSize = 50;

  const { data: statusData } = useQuery<StatusResponse>({
    queryKey: ['/api/omgevingsplannen/status'],
  });

  const { data: municipalitiesData } = useQuery<{ municipalities: Municipality[] }>({
    queryKey: ['/api/omgevingsplannen/municipalities'],
  });

  const { data: typesData } = useQuery<{ documentTypes: DocumentType[], authorityTypes: AuthorityType[] }>({
    queryKey: ['/api/omgevingsplannen/document-types'],
  });

  const isConfigured = statusData?.configured ?? false;
  const municipalities = municipalitiesData?.municipalities || [];
  const documentTypes = typesData?.documentTypes || [];
  const authorityTypes = typesData?.authorityTypes || [];

  const { data: searchData, isLoading: isSearching, refetch: doSearch, error: searchError } = useQuery<SearchResponse>({
    queryKey: ['/api/omgevingsplannen/search', selectedMunicipality, selectedDocumentType, selectedAuthorityType, currentPage],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', currentPage.toString());
      params.set('pageSize', pageSize.toString());
      
      if (selectedMunicipality && selectedMunicipality !== 'all') {
        params.set('bevoegdGezag', selectedMunicipality);
      }
      if (selectedDocumentType && selectedDocumentType !== 'all') {
        params.set('documentType', selectedDocumentType);
      }
      if (selectedAuthorityType && selectedAuthorityType !== 'all') {
        params.set('typeBevoegdGezag', selectedAuthorityType);
      }
      
      const response = await fetch(`/api/omgevingsplannen/search?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Fout bij ophalen omgevingsplannen');
      }
      return response.json();
    },
    enabled: isConfigured && hasSearched,
    staleTime: 5 * 60 * 1000,
  });

  const regelingen = searchData?.regelingen || [];
  const totalRecords = searchData?.totalRecords || 0;
  const totalPages = Math.ceil(totalRecords / pageSize);

  const handleSearch = () => {
    setCurrentPage(0);
    setHasSearched(true);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const getDocumentTypeLabel = (type: string): string => {
    const found = documentTypes.find(dt => dt.value === type);
    return found?.label || type;
  };

  const getDocumentTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      'omgevingsplan': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      'omgevingsverordening': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      'waterschapsverordening': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
      'omgevingsvisie': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      'programma': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      'projectbesluit': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  };

  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Terug
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Omgevingsplannen</h1>
                <p className="text-sm text-muted-foreground">DSO-LV Integratie</p>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-amber-100 dark:bg-amber-900">
                  <Key className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <CardTitle>API-key Vereist</CardTitle>
                  <CardDescription>
                    Om omgevingsplannen te zoeken is een DSO API-key nodig
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Gratis API-key aanvragen</AlertTitle>
                <AlertDescription className="mt-2">
                  <p className="mb-3">
                    De DSO API-key is gratis en kan worden aangevraagd bij het Ontwikkelaarsportaal 
                    van de Omgevingswet. Dezelfde key werkt voor alle DSO API's.
                  </p>
                  <Button asChild variant="outline" size="sm">
                    <a 
                      href="https://developer.omgevingswet.overheid.nl/formulieren/api-key-aanvragen-0/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      data-testid="link-request-api-key"
                    >
                      API-key aanvragen
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </a>
                  </Button>
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <h3 className="font-medium">Na ontvangst van de API-key:</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Kopieer de ontvangen API-key</li>
                  <li>Voeg deze toe als <code className="bg-muted px-1 rounded">DSO_API_KEY</code> in de Secrets</li>
                  <li>Herstart de applicatie</li>
                </ol>
              </div>

              <div className="pt-4 border-t">
                <h3 className="font-medium mb-2">Beschikbare data via DSO-LV:</h3>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Omgevingsplannen</Badge>
                  <Badge variant="secondary">Omgevingsverordeningen</Badge>
                  <Badge variant="secondary">Waterschapsverordeningen</Badge>
                  <Badge variant="secondary">Omgevingsvisies</Badge>
                  <Badge variant="secondary">Programma's</Badge>
                  <Badge variant="secondary">Projectbesluiten</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Terug
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Omgevingsplannen</h1>
                <p className="text-sm text-muted-foreground">
                  Zoek in omgevingsdocumenten via DSO-LV
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-green-600 border-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-2" />
              API Verbonden
            </Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Zoekfilters
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type Bevoegd Gezag</label>
                  <Select 
                    value={selectedAuthorityType} 
                    onValueChange={setSelectedAuthorityType}
                  >
                    <SelectTrigger data-testid="select-authority-type">
                      <SelectValue placeholder="Alle types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle types</SelectItem>
                      {authorityTypes.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Gemeente</label>
                  <Select 
                    value={selectedMunicipality} 
                    onValueChange={setSelectedMunicipality}
                  >
                    <SelectTrigger data-testid="select-municipality">
                      <SelectValue placeholder="Selecteer gemeente" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle gemeenten</SelectItem>
                      {municipalities.map(muni => (
                        <SelectItem key={muni.code} value={muni.code}>
                          {muni.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Documenttype</label>
                  <Select 
                    value={selectedDocumentType} 
                    onValueChange={setSelectedDocumentType}
                  >
                    <SelectTrigger data-testid="select-document-type">
                      <SelectValue placeholder="Alle documenttypes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle documenttypes</SelectItem>
                      {documentTypes.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button 
                  onClick={handleSearch} 
                  className="w-full"
                  disabled={isSearching}
                  data-testid="button-search"
                >
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  Zoeken
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Info className="h-5 w-5" />
                  Over DSO-LV
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>
                  Het Digitaal Stelsel Omgevingswet (DSO) bevat alle 
                  omgevingsdocumenten sinds de inwerkingtreding van de 
                  Omgevingswet op 1 januari 2024.
                </p>
                <p>
                  Omgevingsplannen vervangen de oude bestemmingsplannen, 
                  beheersverordeningen en andere gemeentelijke regelingen.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    {hasSearched ? (
                      <>Resultaten ({totalRecords.toLocaleString('nl-NL')})</>
                    ) : (
                      'Omgevingsdocumenten'
                    )}
                  </CardTitle>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 0}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Pagina {currentPage + 1} van {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages - 1}
                        data-testid="button-next-page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!hasSearched ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg mb-2">Selecteer filters en klik op Zoeken</p>
                    <p className="text-sm">
                      Gebruik de filters links om omgevingsdocumenten te zoeken
                    </p>
                  </div>
                ) : isSearching ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="ml-3 text-muted-foreground">Zoeken...</span>
                  </div>
                ) : searchError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Fout bij zoeken</AlertTitle>
                    <AlertDescription>
                      {(searchError as Error).message}
                    </AlertDescription>
                  </Alert>
                ) : regelingen.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg mb-2">Geen resultaten gevonden</p>
                    <p className="text-sm">
                      Probeer andere zoekfilters
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[600px]">
                    <div className="space-y-3">
                      {regelingen.map((regeling) => (
                        <div
                          key={regeling.identificatie}
                          className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                          data-testid={`regeling-${regeling.identificatie}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-foreground line-clamp-2">
                                {regeling.officieleTitel || regeling.citeerTitel || 'Onbekende titel'}
                              </h3>
                              <div className="flex flex-wrap items-center gap-2 mt-2">
                                <Badge 
                                  variant="secondary"
                                  className={getDocumentTypeColor(regeling.type)}
                                >
                                  {getDocumentTypeLabel(regeling.type)}
                                </Badge>
                                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                  <Building2 className="h-3 w-3" />
                                  {regeling.bevoegdGezag.naam}
                                </div>
                                {regeling.inwerkingtreding && (
                                  <span className="text-xs text-muted-foreground">
                                    In werking: {new Date(regeling.inwerkingtreding).toLocaleDateString('nl-NL')}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 font-mono">
                                {regeling.identificatie}
                              </p>
                            </div>
                            {regeling.documentUrl && (
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                data-testid={`button-view-${regeling.identificatie}`}
                              >
                                <a 
                                  href={regeling.documentUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
