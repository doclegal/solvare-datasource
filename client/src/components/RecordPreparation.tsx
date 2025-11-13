import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { FileText, Trash2, ExternalLink } from "lucide-react";

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

interface RecordPreparationProps {
  ecliCount: number;
  preparedRecords: PreparedRecord[];
  onFetchContent: () => void;
  onClear: () => void;
  isLoading?: boolean;
}

export default function RecordPreparation({
  ecliCount,
  preparedRecords,
  onFetchContent,
  onClear,
  isLoading = false,
}: RecordPreparationProps) {
  const [expandedText, setExpandedText] = useState<Set<string>>(new Set());

  const toggleExpanded = (ecli: string) => {
    const newExpanded = new Set(expandedText);
    if (newExpanded.has(ecli)) {
      newExpanded.delete(ecli);
    } else {
      newExpanded.add(ecli);
    }
    setExpandedText(newExpanded);
  };

  const truncateText = (text: string, ecli: string) => {
    const maxLength = 300;
    if (text.length <= maxLength || expandedText.has(ecli)) {
      return text;
    }
    return text.substring(0, maxLength) + "...";
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Record Preparation</CardTitle>
            <CardDescription>
              Fetch full content and prepare structured records for Pinecone
              {ecliCount > 0 && ` • ${ecliCount} ECLI codes available`}
            </CardDescription>
          </div>
          {preparedRecords.length > 0 && (
            <Button variant="outline" size="sm" onClick={onClear} data-testid="button-clear-records">
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Records
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={onFetchContent}
          disabled={ecliCount === 0 || isLoading}
          variant="outline"
          className="w-full md:w-auto"
          data-testid="button-fetch-content"
        >
          <FileText className="mr-2 h-4 w-4" />
          {isLoading ? "Fetching Content..." : `Fetch Full Content (${ecliCount} decisions)`}
        </Button>

        {preparedRecords.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No records prepared yet. Fetch ECLI decisions first, then click "Fetch Full Content"</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {preparedRecords.length} records prepared
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
                      <p className="text-sm font-medium mb-1">Title</p>
                      <p className="text-sm text-muted-foreground">{record.title}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm font-medium mb-1">Legal Area</p>
                        <div className="flex flex-wrap gap-1">
                          {record.legalArea.map((area) => (
                            <Badge key={area} variant="secondary" className="text-xs">
                              {area}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-1">Procedure Type</p>
                        <p className="text-sm text-muted-foreground">{record.procedureType}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm font-medium mb-1">Source</p>
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
                      <p className="text-sm font-medium mb-1">Full Text Preview</p>
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
                            {expandedText.has(record.ecli) ? "Show less" : "Show more"}
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {record.fullText.length} characters
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
