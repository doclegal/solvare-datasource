import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, CheckCircle2, XCircle, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { PreparedRecord } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const DISCOVERED_ECLIS = [
  "ECLI:NL:CBB:2024:31","ECLI:NL:CBB:2024:32","ECLI:NL:CBB:2024:33","ECLI:NL:CBB:2024:34",
  "ECLI:NL:GHARL:2024:5745","ECLI:NL:HR:1983:AD5666","ECLI:NL:HR:2012:BX5582","ECLI:NL:HR:2012:BX5583",
  "ECLI:NL:HR:2012:BX5587","ECLI:NL:HR:2012:BX5589","ECLI:NL:HR:2012:BX5591","ECLI:NL:HR:2012:BX6397",
  "ECLI:NL:HR:2016:2287","ECLI:NL:HR:2017:3263","ECLI:NL:HR:2018:345","ECLI:NL:HR:2021:106",
  "ECLI:NL:HR:2021:1677","ECLI:NL:HR:2021:1956","ECLI:NL:HR:2022:1084","ECLI:NL:HR:2022:1874",
  "ECLI:NL:HR:2022:61","ECLI:NL:HR:2022:981","ECLI:NL:HR:2023:1006","ECLI:NL:HR:2023:1132",
  "ECLI:NL:HR:2023:1216","ECLI:NL:HR:2023:1281","ECLI:NL:HR:2023:1372","ECLI:NL:HR:2023:1514",
  "ECLI:NL:HR:2023:1630","ECLI:NL:HR:2023:1824","ECLI:NL:HR:2023:456","ECLI:NL:HR:2023:458",
  "ECLI:NL:HR:2023:459","ECLI:NL:HR:2023:472","ECLI:NL:HR:2023:660","ECLI:NL:HR:2023:777",
  "ECLI:NL:HR:2023:965","ECLI:NL:HR:2024:1372","ECLI:NL:HR:2024:1474","ECLI:NL:HR:2024:1553",
  "ECLI:NL:HR:2024:1560","ECLI:NL:HR:2024:1594","ECLI:NL:HR:2024:1774","ECLI:NL:HR:2024:1904",
  "ECLI:NL:HR:2024:1913","ECLI:NL:HR:2024:521","ECLI:NL:HR:2024:622","ECLI:NL:HR:2024:642",
  "ECLI:NL:HR:2024:727","ECLI:NL:HR:2024:85","ECLI:NL:HR:2024:95","ECLI:NL:HR:2024:96",
  "ECLI:NL:HR:2025:1024","ECLI:NL:HR:2025:114","ECLI:NL:HR:2025:186","ECLI:NL:HR:2025:195",
  "ECLI:NL:HR:2025:321","ECLI:NL:HR:2025:543","ECLI:NL:HR:2025:56","ECLI:NL:HR:2025:560",
  "ECLI:NL:HR:2025:592","ECLI:NL:HR:2025:664","ECLI:NL:HR:2025:667","ECLI:NL:HR:2025:723",
  "ECLI:NL:HR:2025:796","ECLI:NL:HR:2025:86","ECLI:NL:HR:2025:87","ECLI:NL:HR:2025:88",
  "ECLI:NL:HR:2025:89","ECLI:NL:HR:2025:898","ECLI:NL:RBAMS:2024:619","ECLI:NL:RBDHA:2025:6874",
  "ECLI:NL:RBGEL:2020:2768","ECLI:NL:RBGEL:2022:2441","ECLI:NL:RBMNE:2023:2068","ECLI:NL:RBNNE:2020:1979",
  "ECLI:NL:RBNNE:2024:3265","ECLI:NL:RVS:2015:1515","ECLI:NL:RVS:2015:889","ECLI:NL:RVS:2018:2432",
  "ECLI:NL:RVS:2021:2437","ECLI:NL:RVS:2023:1035","ECLI:NL:RVS:2024:2989","ECLI:NL:RVS:2025:1667",
  "ECLI:NL:RVS:2025:1801","ECLI:NL:RVS:2025:1806","ECLI:NL:RVS:2025:1821","ECLI:NL:RVS:2025:1830",
  "ECLI:NL:RVS:2025:1837"
];

interface ProgressMessage {
  type: 'info' | 'success' | 'error' | 'complete';
  message?: string;
  records?: PreparedRecord[];
  errors?: Array<{ ecli: string; error: string }>;
  total?: number;
  successful?: number;
  failed?: number;
}

export function AiEnrichment() {
  const [isEnriching, setIsEnriching] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [enrichedRecords, setEnrichedRecords] = useState<PreparedRecord[]>([]);
  const [errors, setErrors] = useState<Array<{ ecli: string; error: string }>>([]);
  const [stats, setStats] = useState<{ total: number; successful: number; failed: number } | null>(null);
  const [expandedRecords, setExpandedRecords] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const toggleRecord = (ecli: string) => {
    setExpandedRecords(prev => {
      const next = new Set(prev);
      if (next.has(ecli)) {
        next.delete(ecli);
      } else {
        next.add(ecli);
      }
      return next;
    });
  };

  const startEnrichment = async () => {
    setIsEnriching(true);
    setProgress([]);
    setEnrichedRecords([]);
    setErrors([]);
    setStats(null);

    try {
      const response = await fetch('/api/rechtspraak/enrich-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eclis: DISCOVERED_ECLIS }),
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
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data: ProgressMessage = JSON.parse(line.slice(6));
              
              if (data.type === 'complete') {
                setEnrichedRecords(data.records || []);
                setErrors(data.errors || []);
                setStats({
                  total: data.total || 0,
                  successful: data.successful || 0,
                  failed: data.failed || 0,
                });
                toast({
                  title: 'AI Enrichment Voltooid',
                  description: `${data.successful} ECLIs succesvol verrijkt, ${data.failed} fouten`,
                });
              } else if (data.message) {
                setProgress(prev => [...prev, data.message!]);
              }
            } catch (e) {
              console.error('Failed to parse SSE message:', e);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Enrichment error:', error);
      toast({
        title: 'Fout bij AI Enrichment',
        description: error.message || 'Er is een fout opgetreden',
        variant: 'destructive',
      });
    } finally {
      setIsEnriching(false);
    }
  };

  const saveToBatch = async () => {
    try {
      await fetch('/api/rechtspraak/create-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: enrichedRecords }),
      });

      queryClient.invalidateQueries({ queryKey: ['/api/rechtspraak/batches'] });

      toast({
        title: 'Batch Opgeslagen',
        description: `${enrichedRecords.length} verrijkte records opgeslagen`,
      });
    } catch (error: any) {
      toast({
        title: 'Fout bij Opslaan',
        description: error.message || 'Kon batch niet opslaan',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Verrijking
              </CardTitle>
              <CardDescription>
                Genereer gestructureerde samenvattingen met GPT-3.5-Turbo voor {DISCOVERED_ECLIS.length} gevonden ECLIs
              </CardDescription>
            </div>
            <Button
              data-testid="button-start-enrichment"
              onClick={startEnrichment}
              disabled={isEnriching}
              size="lg"
            >
              {isEnriching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Bezig...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Genereer Samenvatting
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Totaal ECLIs</p>
              <p className="text-2xl font-bold" data-testid="text-total-eclis">{DISCOVERED_ECLIS.length}</p>
            </div>
            {stats && (
              <>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Succesvol</p>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-successful-count">{stats.successful}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Fouten</p>
                  <p className="text-2xl font-bold text-red-600" data-testid="text-failed-count">{stats.failed}</p>
                </div>
              </>
            )}
          </div>

          {isEnriching && progress.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Voortgang:</p>
              <ScrollArea className="h-48 rounded-md border p-3">
                <div className="space-y-1">
                  {progress.slice(-20).map((msg, i) => (
                    <p key={i} className="text-xs font-mono" data-testid={`text-progress-${i}`}>
                      {msg}
                    </p>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {enrichedRecords.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Verrijkte Records ({enrichedRecords.length})
                </p>
                <Button
                  data-testid="button-save-batch"
                  onClick={saveToBatch}
                  variant="default"
                >
                  Opslaan als Batch
                </Button>
              </div>

              <ScrollArea className="h-96">
                <div className="space-y-2">
                  {enrichedRecords.map((record) => (
                    <Collapsible
                      key={record.ecli}
                      open={expandedRecords.has(record.ecli)}
                      onOpenChange={() => toggleRecord(record.ecli)}
                    >
                      <Card>
                        <CollapsibleTrigger asChild>
                          <CardHeader className="cursor-pointer hover-elevate p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  <code className="text-sm font-mono" data-testid={`text-ecli-${record.ecli}`}>
                                    {record.ecli}
                                  </code>
                                </div>
                                <p className="text-sm text-muted-foreground line-clamp-1">
                                  {record.title}
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="secondary" data-testid={`badge-court-${record.ecli}`}>
                                    {record.court}
                                  </Badge>
                                  <Badge variant="outline" data-testid={`badge-date-${record.ecli}`}>
                                    {record.decisionDate}
                                  </Badge>
                                  {record.ai_inhoudsindicatie && (
                                    <Badge variant="default" data-testid={`badge-ai-${record.ecli}`}>
                                      <Sparkles className="h-3 w-3 mr-1" />
                                      AI
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              {expandedRecords.has(record.ecli) ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </CardHeader>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <CardContent className="pt-0 space-y-3">
                            {record.ai_inhoudsindicatie && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground">AI Inhoudsindicatie:</p>
                                <p className="text-sm" data-testid={`text-ai-summary-${record.ecli}`}>
                                  {record.ai_inhoudsindicatie}
                                </p>
                              </div>
                            )}
                            {record.ai_feiten && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground">AI Feiten:</p>
                                <p className="text-sm">{record.ai_feiten}</p>
                              </div>
                            )}
                            {record.ai_geschil && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground">AI Geschil:</p>
                                <p className="text-sm">{record.ai_geschil}</p>
                              </div>
                            )}
                            {record.ai_beslissing && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground">AI Beslissing:</p>
                                <p className="text-sm">{record.ai_beslissing}</p>
                              </div>
                            )}
                            {record.ai_motivering && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground">AI Motivering:</p>
                                <p className="text-sm">{record.ai_motivering}</p>
                              </div>
                            )}
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-600">Fouten ({errors.length}):</p>
              <ScrollArea className="h-32 rounded-md border p-3">
                <div className="space-y-2">
                  {errors.map((err, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs" data-testid={`text-error-${i}`}>
                      <XCircle className="h-3 w-3 text-red-600 mt-0.5" />
                      <div>
                        <code className="font-mono">{err.ecli}</code>
                        <p className="text-muted-foreground">{err.error}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {!isEnriching && enrichedRecords.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Klik op "Genereer Samenvatting" om te starten
              </p>
              <p className="text-xs text-muted-foreground">
                Dit genereert AI samenvattingen voor alle {DISCOVERED_ECLIS.length} ECLIs (kan enkele minuten duren)
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
