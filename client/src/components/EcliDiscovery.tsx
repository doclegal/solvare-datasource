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
  type: 'crawl' | 'extract' | 'validate' | 'check_processed' | 'discovery_complete' | 'error';
  message: string;
  url?: string;
  ecli?: string;
  preparedRecords?: PreparedRecord[];
  totalRecords?: number;
}

interface Props {
  onRecordsDiscovered: (records: PreparedRecord[]) => void;
}

export function EcliDiscovery({ onRecordsDiscovered }: Props) {
  const [sourceUrls, setSourceUrls] = useState<string[]>(['', '', '']);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const { toast } = useToast();
  
  const addLog = (message: string) => {
    setLogs(prev => [...prev, message]);
  };
  
  const addUrlField = () => {
    setSourceUrls([...sourceUrls, '']);
  };
  
  const removeUrlField = (index: number) => {
    if (sourceUrls.length <= 1) return;
    setSourceUrls(sourceUrls.filter((_, i) => i !== index));
  };
  
  const updateUrl = (index: number, value: string) => {
    const updated = [...sourceUrls];
    updated[index] = value;
    setSourceUrls(updated);
  };
  
  const handleDiscover = async () => {
    // Filter out empty URLs
    const validUrls = sourceUrls.filter(url => url.trim() !== '');
    
    if (validUrls.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Geen URLs',
        description: 'Voer minimaal 1 URL in om te crawlen',
      });
      return;
    }
    
    // Validate URL format
    const invalidUrls = validUrls.filter(url => {
      try {
        new URL(url);
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
          namespace: 'ECLI_NL',
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
          <Label>URL's om te crawlen</Label>
          
          {sourceUrls.map((url, index) => (
            <div key={index} className="flex gap-2">
              <Input
                data-testid={`input-url-${index}`}
                type="url"
                placeholder="https://www.voorbeeld.nl/uitspraken"
                value={url}
                onChange={(e) => updateUrl(index, e.target.value)}
                disabled={isDiscovering}
              />
              {sourceUrls.length > 1 && (
                <Button
                  data-testid={`button-remove-url-${index}`}
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeUrlField(index)}
                  disabled={isDiscovering}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
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
