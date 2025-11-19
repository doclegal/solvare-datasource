import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Search, Globe } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { PreparedRecord } from '@shared/schema';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';

interface DiscoveryProgress {
  type: 'search_start' | 'search_results' | 'url_fetch' | 'ecli_found' | 
        'ecli_validated' | 'discovery_complete' | 'error';
  message: string;
  url?: string;
  ecli?: string;
  resultsFound?: number;
  totalEclis?: number;
  validEclis?: number;
  eclis?: string[];
  preparedRecords?: PreparedRecord[];
}

interface DomainInput {
  id: string;
  domain: string;
  isActive: boolean;
}

interface Props {
  onRecordsDiscovered: (records: PreparedRecord[]) => void;
}

const DEFAULT_DOMAINS = [
  'recht.nl',
  'cassatieblog.nl',
  'avdr.nl',
  'stibbe.com',
  'njb.nl',
];

export default function WebSearchDiscovery({ onRecordsDiscovered }: Props) {
  const [query, setQuery] = useState('ECLI:NL: huurrecht');
  const [domains, setDomains] = useState<DomainInput[]>(
    DEFAULT_DOMAINS.map((d, i) => ({ id: `domain-${i}`, domain: d, isActive: true }))
  );
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [results, setResults] = useState<PreparedRecord[]>([]);
  const { toast } = useToast();

  const addDomain = () => {
    setDomains([...domains, { id: `domain-${Date.now()}`, domain: '', isActive: true }]);
  };

  const removeDomain = (id: string) => {
    setDomains(domains.filter(d => d.id !== id));
  };

  const updateDomain = (id: string, domain: string) => {
    setDomains(domains.map(d => d.id === id ? { ...d, domain } : d));
  };

  const toggleDomain = (id: string) => {
    setDomains(domains.map(d => d.id === id ? { ...d, isActive: !d.isActive } : d));
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setProgress([]);
    setResults([]);

    const activeDomains = domains
      .filter(d => d.isActive && d.domain.trim())
      .map(d => d.domain.trim());

    try {
      const response = await fetch('/api/discovery/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          domains: activeDomains.length > 0 ? activeDomains : undefined,
          maxResults: 20,
        }),
      });

      if (!response.ok) {
        throw new Error('Search request failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response stream');
      }

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as DiscoveryProgress;
            
              setProgress(prev => [...prev, data.message]);

              if (data.type === 'discovery_complete' && data.preparedRecords) {
                setResults(data.preparedRecords);
                onRecordsDiscovered(data.preparedRecords);
                
                toast({
                  title: 'Discovery voltooid',
                  description: `${data.preparedRecords.length} geldige ECLI's gevonden`,
                });
              } else if (data.type === 'error') {
                toast({
                  title: 'Fout tijdens discovery',
                  description: data.message,
                  variant: 'destructive',
                });
              }
            } catch (parseError) {
              // Ignore JSON parse errors from partial chunks
              console.log('SSE parse error (partial chunk):', parseError);
            }
          }
        }
      }
    } catch (error: any) {
      toast({
        title: 'Discovery mislukt',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Group results by source domain
  const resultsByDomain = results.reduce((acc, record) => {
    try {
      const domain = new URL(record.sourceUrl).hostname;
      if (!acc[domain]) {
        acc[domain] = [];
      }
      acc[domain].push(record);
    } catch {
      if (!acc['Overig']) {
        acc['Overig'] = [];
      }
      acc['Overig'].push(record);
    }
    return acc;
  }, {} as Record<string, PreparedRecord[]>);

  return (
    <Card data-testid="card-web-search-discovery">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Web Search Discovery
        </CardTitle>
        <CardDescription>
          Zoek ECLI's via web search (Serper.dev - 2,500 gratis searches)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Query */}
        <div className="space-y-2">
          <Label htmlFor="search-query" data-testid="label-search-query">Zoekterm</Label>
          <Input
            id="search-query"
            data-testid="input-search-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Bijv: "ECLI:NL: huurrecht" of "ECLI:NL:HR arbeidsrecht"'
          />
          <p className="text-sm text-muted-foreground">
            Tip: Combineer "ECLI:NL:" met trefwoorden zoals huurrecht, arbeidsrecht, etc.
          </p>
        </div>

        {/* Domain Filters */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label data-testid="label-domains">Bronnen (domeinen)</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addDomain}
              data-testid="button-add-domain"
            >
              <Plus className="w-4 h-4 mr-1" />
              Bron toevoegen
            </Button>
          </div>

          <div className="space-y-2">
            {domains.map((domain) => (
              <div key={domain.id} className="flex items-center gap-2" data-testid={`domain-row-${domain.id}`}>
                <Button
                  type="button"
                  variant={domain.isActive ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleDomain(domain.id)}
                  data-testid={`button-toggle-${domain.id}`}
                  className="min-w-20"
                >
                  {domain.isActive ? 'Actief' : 'Inactief'}
                </Button>
                <Input
                  value={domain.domain}
                  onChange={(e) => updateDomain(domain.id, e.target.value)}
                  placeholder="bijv: recht.nl"
                  disabled={!domain.isActive}
                  data-testid={`input-domain-${domain.id}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDomain(domain.id)}
                  data-testid={`button-remove-${domain.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Laat leeg om het hele web te doorzoeken. Actieve bronnen worden grijs na gebruik.
          </p>
        </div>

        {/* Search Button */}
        <Button
          onClick={handleSearch}
          disabled={isSearching || !query.trim()}
          className="w-full"
          data-testid="button-scan-web"
        >
          <Search className="w-4 h-4 mr-2" />
          {isSearching ? 'Zoeken...' : 'Scan web (20 resultaten)'}
        </Button>

        {/* Progress Log */}
        {progress.length > 0 && (
          <div className="rounded-md border p-3 max-h-40 overflow-y-auto space-y-1" data-testid="progress-log">
            {progress.map((msg, i) => (
              <div key={i} className="text-sm text-muted-foreground" data-testid={`progress-${i}`}>
                {msg}
              </div>
            ))}
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div className="space-y-3" data-testid="results-section">
            <h3 className="font-semibold">Resultaten ({results.length} ECLI's)</h3>
            
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ECLI</TableHead>
                  <TableHead>Instantie</TableHead>
                  <TableHead>#Bron</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((record) => {
                  const domain = (() => {
                    try {
                      return new URL(record.sourceUrl).hostname;
                    } catch {
                      return 'Onbekend';
                    }
                  })();
                  
                  return (
                    <TableRow key={record.ecli} data-testid={`result-row-${record.ecli}`}>
                      <TableCell className="font-mono text-sm" data-testid={`text-ecli-${record.ecli}`}>
                        {record.ecli}
                      </TableCell>
                      <TableCell data-testid={`text-court-${record.ecli}`}>
                        {record.court}
                      </TableCell>
                      <TableCell data-testid={`text-source-${record.ecli}`}>
                        <Badge variant="outline">{domain}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Domain Summary */}
            <div className="text-sm text-muted-foreground" data-testid="domain-summary">
              <strong>Per bron:</strong> {Object.entries(resultsByDomain).map(([domain, recs]) => (
                <Badge key={domain} variant="secondary" className="ml-2">
                  {domain}: {recs.length}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
