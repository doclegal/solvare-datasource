import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { FileText, Trash2, ExternalLink, Sparkles } from "lucide-react";

export interface PreparedRecord {
  ecli: string;
  title: string;
  court: string;
  decisionDate: string;
  legalArea: string[];
  procedureType: string;
  sourceUrl: string;
  fullText: string;
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
  onPrepareChunks?: () => void;
  onFetchContent: () => void;
  onClear: () => void;
  isLoading?: boolean;
  isPreparingChunks?: boolean;
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
  isLoading = false,
  isPreparingChunks = false,
}: RecordPreparationProps) {
  const [expandedText, setExpandedText] = useState<Set<string>>(new Set());
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());

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
            <CardTitle>Voorbereide Records {chunkedData && '& Chunks'}</CardTitle>
            <CardDescription>
              {chunkedData 
                ? `${chunkedData.allChunks.length} chunks voorbereid uit ${preparedRecords.length} uitspraken`
                : `Civielrechtelijke uitspraken met volledige tekst${preparedRecords.length > 0 ? ` • ${preparedRecords.length} records` : ''}`
              }
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {preparedRecords.length > 0 && !chunkedData && onPrepareChunks && (
              <Button 
                variant="default" 
                size="sm" 
                onClick={onPrepareChunks}
                disabled={isPreparingChunks || preparedRecords.length === 0}
                data-testid="button-prepare-chunks"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {isPreparingChunks ? 'Bezig...' : 'Chunks Voorbereiden'}
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
            <p>Gebruik de filters hierboven om civielrechtelijke uitspraken op te halen. De volledige tekst wordt automatisch opgehaald en hier getoond.</p>
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
                      >
                        {record.sourceUrl}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>

                    <div>
                      <p className="text-sm font-medium mb-1">Voorvertoning Volledige Tekst</p>
                      <div className="bg-muted p-3 rounded-md">
                        <p className="text-sm font-mono whitespace-pre-wrap">
                          {truncateText(record.fullText, record.ecli)}
                        </p>
                        {record.fullText.length > 300 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 p-0 h-auto"
                            onClick={() => toggleExpanded(record.ecli)}
                          >
                            {expandedText.has(record.ecli) ? "Minder tonen" : "Meer tonen"}
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {record.fullText.length} tekens
                      </p>
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
