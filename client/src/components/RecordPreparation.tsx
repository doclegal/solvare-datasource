import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, Trash2, ExternalLink, Sparkles, Info, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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
  ai_title?: string; // AI-generated title (fallback when title is empty)
  ai_inhoudsindicatie?: string;
  ai_feiten?: string;
  ai_geschil?: string;
  ai_beslissing?: string;
  ai_motivering?: string;
}

interface RecordPreparationProps {
  preparedRecords: PreparedRecord[];
  onClear: () => void;
  onEnrichWithAI?: () => void;
  isEnrichingWithAI?: boolean;
}

export default function RecordPreparation({
  preparedRecords,
  onClear,
  onEnrichWithAI,
  isEnrichingWithAI = false,
}: RecordPreparationProps) {
  const [expandedText, setExpandedText] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

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
  
  // Count enriched records
  const enrichedCount = preparedRecords.filter(r => 
    r.ai_title || r.ai_inhoudsindicatie || r.ai_feiten || 
    r.ai_geschil || r.ai_beslissing || r.ai_motivering
  ).length;

  const handleTestUpload = async () => {
    setIsUploading(true);
    try {
      const response = await apiRequest('POST', '/api/pinecone/test-upload');
      const data = await response.json();
      
      toast({
        title: 'Upload Voltooid',
        description: `${data.uploaded || 0} records geüpload naar Pinecone. ${data.alreadyUploaded > 0 ? `${data.alreadyUploaded} al geüpload.` : ''}`,
      });
      
      console.log('[Test Upload] Result:', data);
    } catch (error: any) {
      toast({
        title: 'Upload Mislukt',
        description: error.message || 'Er is een fout opgetreden',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Metadata Records</CardTitle>
            <CardDescription>
              {preparedRecords.length > 0 ? (
                <>
                  {preparedRecords.length} records • {enrichedCount} AI-verrijkt
                </>
              ) : (
                'Civielrechtelijke uitspraken met metadata'
              )}
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
                {isEnrichingWithAI ? 'Bezig met verrijken...' : 'Start AI Verrijking'}
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
        ) : (
          <div className="space-y-3">
            {enrichedCount > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Records worden automatisch geüpload naar Pinecone na AI verrijking. Handmatige upload is niet meer nodig.
                </AlertDescription>
              </Alert>
            )}
            
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
      
      {enrichedCount > 0 && (
        <CardFooter className="flex justify-between items-center border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Test de Pinecone upload door de eerste 5 verrijkte records te uploaden
          </p>
          <Button 
            variant="default" 
            size="sm" 
            onClick={handleTestUpload}
            disabled={isUploading}
            data-testid="button-test-upload"
          >
            <Upload className="mr-2 h-4 w-4" />
            {isUploading ? 'Bezig met uploaden...' : 'Test Upload naar Pinecone'}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
