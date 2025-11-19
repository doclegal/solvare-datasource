import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { PreparedRecord } from '@shared/schema';

interface DiscoveryProgress {
  type: 'section_crawl_start' | 'section_crawl_page' | 'section_crawl_complete' | 
        'validate' | 'check_processed' | 'discovery_complete' | 'error';
  message: string;
  url?: string;
  ecli?: string;
  sectionRoot?: string;
  currentDepth?: number;
  queueSize?: number;
  processedPages?: number;
  eclisFound?: number;
  preparedRecords?: PreparedRecord[];
  totalRecords?: number;
}

interface UrlWithLabel {
  url: string;
  label: string;
}

interface Props {
  onRecordsDiscovered: (records: PreparedRecord[]) => void;
}

const DEFAULT_URLS: UrlWithLabel[] = [
  {
    url: 'https://www.avdr.nl/jurisprudentie/huurrecht/',
    label: 'Huurrecht (civiel) - Academie voor de Rechtspraktijk'
  },
  {
    url: 'https://cassatieblog.nl/',
    label: 'Civiele cassatierechtspraak (breed) - cassatieblog.nl'
  },
  {
    url: 'https://www.recht.nl/vakliteratuur/bhv/aflevering/39339/jurisprudentie-voorheen-journaal-huur-verhuur/2024/12',
    label: 'Huur & verhuur (civiel) - recht.nl'
  },
  {
    url: 'https://trip.nl/blogs/jurisprudentie-verhuur-onroerende-zaken-n-a-v-d-didam-arrest/',
    label: 'Verhuur/onroerende zaken huurrecht (civiel) - TRIP Advocaten'
  },
  {
    url: 'https://www.stibbe.com/nl/publications-and-insights/signaleringsblog-week-18-actuele-jurisprudentie-en-ontwikkelingen',
    label: 'Bestuursrecht / omgevingsrecht - Stibbe'
  },
  {
    url: 'https://www.ungernolet.nl/2023/03/23/blog-jurisprudentie-uitzend-/detacheringsovereenkomsten-nummer-3/',
    label: 'Uitzend-/detacheringsovereenkomsten (arbeidsrecht) - Unger Nolet'
  },
  {
    url: 'https://www.njb.nl/nieuws/uitspraak-hoge-raad-over-buy-now-pay-later-diensten/',
    label: 'Consumentenkrediet/consumentenrecht - NJB'
  },
  {
    url: 'https://www.benk.nl/actueel-blog-wat-in-het-verleden-normaal-was-hoeft-dat-vandaag-niet-meer-te-zijn/',
    label: 'Huurrecht/verhuur (civiel) - Benk'
  },
  {
    url: 'https://yspeert.nl/yspeert-learning/kennisbank/twee-rechterlijke-uitspraken-over-corona-en-huur-heeft-een-huurder-recht-op-huurprijsvermindering/',
    label: 'Huurrecht verminderingsvordering (civiel) - Yspeert'
  },
  {
    url: 'https://wijnenstael.nl/nl/updates/doorberekening-vastrecht-door-exploitant-wko-installatie-aan-huurders-woonruimte-houdt-stand',
    label: 'Huurrecht/woonruimte (civiel) - Wijnenstael'
  }
];

export function EcliDiscovery({ onRecordsDiscovered }: Props) {
  const [sourceUrls, setSourceUrls] = useState<UrlWithLabel[]>(DEFAULT_URLS);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const { toast } = useToast();
  
  const addLog = (message: string) => {
    setLogs(prev => [...prev, message]);
  };
  
  const addUrlField = () => {
    setSourceUrls([...sourceUrls, { url: '', label: 'Aangepaste URL' }]);
  };
  
  const removeUrlField = (index: number) => {
    if (sourceUrls.length <= 1) return;
    setSourceUrls(sourceUrls.filter((_, i) => i !== index));
  };
  
  const updateUrl = (index: number, field: 'url' | 'label', value: string) => {
    const updated = [...sourceUrls];
    updated[index] = { ...updated[index], [field]: value };
    setSourceUrls(updated);
  };
  
  const handleDiscover = async () => {
    // Filter out empty URLs
    const validUrlObjects = sourceUrls.filter(item => item.url.trim() !== '');
    
    if (validUrlObjects.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Geen URLs',
        description: 'Voer minimaal 1 URL in om te crawlen',
      });
      return;
    }
    
    // Validate URL format
    const invalidUrls = validUrlObjects.filter(item => {
      try {
        new URL(item.url);
        return false;
      } catch {
        return true;
      }
    });
    
    if (invalidUrls.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Ongeldige URL(s)',
        description: `${invalidUrls.length} URL(s) hebben een ongeldig formaat`,
      });
      return;
    }
    
    // Extract just the URLs for the API call
    const validUrls = validUrlObjects.map(item => item.url);
    
    setIsDiscovering(true);
    setLogs([]);
    addLog(`Start discovery op ${validUrls.length} URL(s)...`);
    
    try {
      const response = await fetch('/api/ecli-discovery/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceUrls: validUrls,
          // Backend automatically tags with source: 'web_search' → WEB_ECLI namespace
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          const data: DiscoveryProgress = JSON.parse(line.slice(6));
          
          // Log progress
          addLog(data.message);
          
          // Handle completion
          if (data.type === 'discovery_complete') {
            const records = data.preparedRecords || [];
            addLog(`✓ Discovery voltooid: ${records.length} records gevonden`);
            
            if (records.length > 0) {
              onRecordsDiscovered(records);
              
              toast({
                title: 'Discovery voltooid',
                description: `${records.length} nieuwe ECLI's gevonden en klaar voor verwerking`,
              });
            } else {
              toast({
                title: 'Discovery voltooid',
                description: 'Geen nieuwe ECLI\'s gevonden',
              });
            }
          } else if (data.type === 'error') {
            addLog(`✗ Fout: ${data.message}`);
            throw new Error(data.message);
          }
        }
      }
    } catch (error: any) {
      console.error('Discovery error:', error);
      addLog(`✗ Fout: ${error.message}`);
      
      toast({
        variant: 'destructive',
        title: 'Discovery mislukt',
        description: error.message || 'Er is een fout opgetreden',
      });
    } finally {
      setIsDiscovering(false);
    }
  };
  
  return (
    <Card data-testid="card-ecli-discovery">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          ECLI Discovery
        </CardTitle>
        <CardDescription>
          Ontdek ECLI-nummers op externe juridische websites en verwerk ze automatisch
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label>URL's om te crawlen ({sourceUrls.length} websites)</Label>
          
          {sourceUrls.map((item, index) => (
            <div key={index} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{item.label}</Label>
                {sourceUrls.length > 1 && (
                  <Button
                    data-testid={`button-remove-url-${index}`}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => removeUrlField(index)}
                    disabled={isDiscovering}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Input
                data-testid={`input-url-${index}`}
                type="url"
                placeholder="https://www.voorbeeld.nl/uitspraken"
                value={item.url}
                onChange={(e) => updateUrl(index, 'url', e.target.value)}
                disabled={isDiscovering}
              />
            </div>
          ))}
          
          <Button
            data-testid="button-add-url"
            type="button"
            variant="outline"
            size="sm"
            onClick={addUrlField}
            disabled={isDiscovering}
          >
            <Plus className="h-4 w-4 mr-2" />
            URL toevoegen
          </Button>
        </div>
        
        <Button
          data-testid="button-discover"
          onClick={handleDiscover}
          disabled={isDiscovering}
          className="w-full"
        >
          {isDiscovering ? 'Aan het crawlen...' : 'Start Discovery'}
        </Button>
        
        {logs.length > 0 && (
          <div className="mt-4">
            <Label>Voortgang</Label>
            <div
              data-testid="log-discovery-progress"
              className="mt-2 p-3 bg-muted rounded-md max-h-48 overflow-y-auto font-mono text-xs space-y-1"
            >
              {logs.map((log, i) => (
                <div key={i} className="text-muted-foreground">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
