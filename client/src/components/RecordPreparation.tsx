import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FileText, Trash2, ExternalLink, Sparkles, Bot } from "lucide-react";

export interface PreparedRecord {
  ecli: string;
  title: string;
  court: string;
  decisionDate: string;
  legalArea: string[];
  procedureType: string;
  sourceUrl: string;
  inhoudsindicatie: string; // Required - official summary
  
  // AI-generated summary sections
  ai_inhoudsindicatie?: string;
  ai_feiten?: string;
  ai_geschil?: string;
  ai_beslissing?: string;
  ai_motivering?: string;
}

interface ChunkedRecord {
  ecli: string;
  chunk_id: string;
  section_type: string;
  title: string;
  text: string;
  [key: string]: any;
}

interface ChunksByEcli {
  ecli: string;
  title: string;
  totalChunks: number;
  sectionCounts: Record<string, number>;
  chunks: ChunkedRecord[];
}

interface RecordPreparationProps {
  ecliCount: number;
  preparedRecords: PreparedRecord[];
  chunkedData?: { chunksByEcli: Record<string, ChunksByEcli>; allChunks: ChunkedRecord[] } | null;
  onPrepareChunks?: (useLLM: boolean) => void;
  onFetchContent: () => void;
  onClear: () => void;
  onEnrichWithAI?: () => void;
  isLoading?: boolean;
  isPreparingChunks?: boolean;
  isEnrichingWithAI?: boolean;
}

const SECTION_TYPE_LABELS: Record<string, string> = {
  summary: 'Samenvatting',
  claims: 'Vorderingen',
  facts: 'Feiten',
  reasoning: 'Beoordeling',
  decision: 'Beslissing',
  other: 'Overig',
};

const SECTION_TYPE_COLORS: Record<string, string> = {
  summary: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  claims: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  facts: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  reasoning: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  decision: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  other: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
};

export default function RecordPreparation({
  ecliCount,
  preparedRecords,
  chunkedData,
  onPrepareChunks,
  onFetchContent,
  onClear,
  onEnrichWithAI,
  isLoading = false,
  isPreparingChunks = false,
  isEnrichingWithAI = false,
}: RecordPreparationProps) {
  const [expandedText, setExpandedText] = useState<Set<string>>(new Set());
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());
  const [useLLMChunking, setUseLLMChunking] = useState(false);

  const toggleExpanded = (ecli: string) => {
    const newExpanded = new Set(expandedText);
    if (newExpanded.has(ecli)) {
      newExpanded.delete(ecli);
    } else {
      newExpanded.add(ecli);
    }
    setExpandedText(newExpanded);
  };

  const toggleChunkExpanded = (chunkId: string) => {
    const newExpanded = new Set(expandedChunks);
    if (newExpanded.has(chunkId)) {
      newExpanded.delete(chunkId);
    } else {
      newExpanded.add(chunkId);
    }
    setExpandedChunks(newExpanded);
  };

  const truncateText = (text: string, ecli: string) => {
    const maxLength = 300;
    if (text.length <= maxLength || expandedText.has(ecli)) {
      return text;
    }
    return text.substring(0, maxLength) + "...";
  };
  
  const truncateChunkText = (text: string, chunkId: string) => {
    const maxLength = 200;
    if (text.length <= maxLength || expandedChunks.has(chunkId)) {
      return text;
    }
    return text.substring(0, maxLength) + "...";
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Metadata Records</CardTitle>
            <CardDescription>
              {chunkedData 
                ? `${chunkedData.allChunks.length} chunks voorbereid uit ${preparedRecords.length} uitspraken`
                : `Civielrechtelijke uitspraken met metadata${preparedRecords.length > 0 ? ` • ${preparedRecords.length} records` : ''}`
              }
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {preparedRecords.length > 0 && onEnrichWithAI && (
              <Button 
                variant="default" 
                size="sm" 
                onClick={onEnrichWithAI} 
                disabled={isEnrichingWithAI}
                data-testid="button-enrich-ai"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {isEnrichingWithAI ? 'Bezig met verrijken...' : 'Genereer AI Samenvatting'}
              </Button>
            )}
            {preparedRecords.length > 0 && (
              <Button variant="outline" size="sm" onClick={onClear} data-testid="button-clear-records">
                <Trash2 className="mr-2 h-4 w-4" />
                Wissen
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {preparedRecords.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Gebruik de filters hierboven om uitspraken met metadata op te halen.</p>
          </div>
        ) : chunkedData ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {Object.keys(chunkedData.chunksByEcli).length} uitspraken • {chunkedData.allChunks.length} chunks
              </p>
            </div>
            
            <Accordion type="multiple" className="space-y-2">
              {Object.values(chunkedData.chunksByEcli).map((ecliData) => (
                <AccordionItem 
                  key={ecliData.ecli} 
                  value={ecliData.ecli}
                  className="border rounded-md px-4"
                  data-testid={`accordion-chunks-${ecliData.ecli}`}
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-left flex-wrap">
                      <span className="font-mono text-sm font-medium">{ecliData.ecli}</span>
                      <Badge variant="secondary">{ecliData.totalChunks} chunks</Badge>
                      {Object.entries(ecliData.sectionCounts).map(([type, count]) => (
                        <Badge 
                          key={type} 
                          className={`text-xs ${SECTION_TYPE_COLORS[type] || ''}`}
                        >
                          {SECTION_TYPE_LABELS[type] || type}: {count}
                        </Badge>
                      ))}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-3">
                    <div className="space-y-2">
                      {ecliData.chunks.map((chunk, idx) => (
                        <div key={chunk.chunk_id} className="border rounded-md p-3 bg-muted/30">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <Badge className={`text-xs ${SECTION_TYPE_COLORS[chunk.section_type] || ''}`}>
                                {SECTION_TYPE_LABELS[chunk.section_type] || chunk.section_type}
                              </Badge>
                              <span className="text-xs text-muted-foreground font-mono">
                                #{idx + 1}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {chunk.text.length} tekens
                            </span>
                          </div>
                          <div className="bg-background p-2 rounded text-sm font-mono whitespace-pre-wrap">
                            {truncateChunkText(chunk.text, chunk.chunk_id)}
                          </div>
                          {chunk.text.length > 200 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2 p-0 h-auto text-xs"
                              onClick={() => toggleChunkExpanded(chunk.chunk_id)}
                            >
                              {expandedChunks.has(chunk.chunk_id) ? "Minder tonen" : "Meer tonen"}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {preparedRecords.length} records voorbereid
              </p>
            </div>
            
            <Accordion type="multiple" className="space-y-2">
              {preparedRecords.map((record, idx) => (
                <AccordionItem 
                  key={record.ecli} 
                  value={record.ecli}
                  className="border rounded-md px-4"
                  data-testid={`accordion-record-${idx}`}
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 text-left">
                      <span className="font-mono text-sm font-medium">{record.ecli}</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-sm text-muted-foreground">{record.court}</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-sm text-muted-foreground">{record.decisionDate}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pt-3">
                    <div>
                      <p className="text-sm font-medium mb-1">Titel</p>
                      <p className="text-sm text-muted-foreground">{record.title}</p>
                    </div>

                    {/* AI Summary Sections - Show only if available */}
                    {record.ai_inhoudsindicatie && (
                      <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
                        <div className="flex items-center gap-2 mb-3">
                          <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                          <p className="text-sm font-semibold text-purple-900 dark:text-purple-100">AI Samenvatting</p>
                          <Badge variant="secondary" className="text-xs">GPT-3.5</Badge>
                        </div>
                        
                        <div className="space-y-3">
                          <div>
                            <h4 className="text-xs font-semibold text-purple-800 dark:text-purple-200 mb-1">Inhoudsindicatie</h4>
                            <p className="text-sm text-purple-900 dark:text-purple-100 leading-relaxed">{record.ai_inhoudsindicatie}</p>
                          </div>
                          
                          {record.ai_feiten && (
                            <div>
                              <h4 className="text-xs font-semibold text-purple-800 dark:text-purple-200 mb-1">Feiten</h4>
                              <p className="text-sm text-purple-900 dark:text-purple-100 leading-relaxed">{record.ai_feiten}</p>
                            </div>
                          )}
                          
                          {record.ai_geschil && (
                            <div>
                              <h4 className="text-xs font-semibold text-purple-800 dark:text-purple-200 mb-1">Geschil</h4>
                              <p className="text-sm text-purple-900 dark:text-purple-100 leading-relaxed">{record.ai_geschil}</p>
                            </div>
                          )}
                          
                          {record.ai_beslissing && (
                            <div>
                              <h4 className="text-xs font-semibold text-purple-800 dark:text-purple-200 mb-1">Beslissing</h4>
                              <p className="text-sm text-purple-900 dark:text-purple-100 leading-relaxed">{record.ai_beslissing}</p>
                            </div>
                          )}
                          
                          {record.ai_motivering && (
                            <div>
                              <h4 className="text-xs font-semibold text-purple-800 dark:text-purple-200 mb-1">Motivering</h4>
                              <p className="text-sm text-purple-900 dark:text-purple-100 leading-relaxed">{record.ai_motivering}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Original Inhoudsindicatie - Show only if no AI summary */}
                    {!record.ai_inhoudsindicatie && record.inhoudsindicatie && (
                      <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-md border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Inhoudsindicatie</p>
                        </div>
                        <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
                          {record.inhoudsindicatie}
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium mb-1">Rechtsgebied</p>
                        <div className="flex flex-wrap gap-1">
                          {record.legalArea.map((area) => (
                            <Badge key={area} variant="secondary" className="text-xs">
                              {area}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-1">Proceduresoort</p>
                        <p className="text-sm text-muted-foreground">{record.procedureType}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm font-medium mb-1">Bron</p>
                      <a 
                        href={record.sourceUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                        data-testid={`link-source-${record.ecli}`}
                      >
                        Bekijk volledige uitspraak
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
