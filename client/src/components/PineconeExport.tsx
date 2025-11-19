import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Info, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PineconeExportProps {
  recordCount: number;
  enrichedRecordCount?: number; // Count of AI-enriched records
  isChunked?: boolean;
  civilSubcategory?: string;
  preparedRecords?: any[]; // The actual records to detect source/namespace
  onExport: (config: ExportConfig) => void;
  isExporting?: boolean;
  exportLogs?: string[];
}

export interface ExportConfig {
  indexHost: string;
  namespace: string;
  batchSize: number;
}

// Determine namespace(s) from records based on their source field
const getNamespacesFromRecords = (records: any[]): string => {
  if (!records || records.length === 0) {
    return 'ECLI_NL';
  }
  
  const hasWebSearch = records.some(r => r.source === 'web_search');
  const hasApiSearch = records.some(r => r.source === 'api_search' || !r.source);
  
  if (hasWebSearch && hasApiSearch) {
    return 'WEB_ECLI + ECLI_NL';
  } else if (hasWebSearch) {
    return 'WEB_ECLI';
  } else {
    return 'ECLI_NL';
  }
};

export default function PineconeExport({
  recordCount,
  enrichedRecordCount = 0,
  isChunked = false,
  civilSubcategory = 'all',
  preparedRecords = [],
  onExport,
  isExporting = false,
  exportLogs = [],
}: PineconeExportProps) {
  const [indexHost, setIndexHost] = useState("rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io");
  const [displayNamespace, setDisplayNamespace] = useState(""); // Display only
  const [batchSize, setBatchSize] = useState("100");
  const [isClearing, setIsClearing] = useState(false);
  const { toast } = useToast();
  
  // Auto-detect namespace display from records based on their source field
  useEffect(() => {
    const detectedNamespace = getNamespacesFromRecords(preparedRecords);
    setDisplayNamespace(detectedNamespace);
  }, [preparedRecords]);

  const handleExport = () => {
    onExport({
      indexHost,
      // Backend does automatic source-based routing for PreparedRecords
      // For chunks, use default ECLI_NL namespace
      namespace: 'ECLI_NL',
      batchSize: parseInt(batchSize) || 100,
    });
  };

  const handleClearProcessedDatabase = async () => {
    // ROBUST & SIMPLE APPROACH: Always clear BOTH namespaces
    // This is a debug/admin tool - safer to clear everything than miss records
    // Clearing empty namespaces has no downside (just returns deleted: 0)
    
    if (!confirm(`Weet je zeker dat je alle verwerkte ECLI's uit BEIDE namespaces (WEB_ECLI + ECLI_NL) wilt verwijderen? Dit staat je toe om alle records opnieuw te uploaden.`)) {
      return;
    }

    setIsClearing(true);
    try {
      let webDeleted = 0;
      let apiDeleted = 0;
      
      // Always clear both namespaces sequentially
      const webResponse = await apiRequest('DELETE', '/api/processed-eclis/clear', { namespace: 'WEB_ECLI' });
      const webData = await webResponse.json();
      webDeleted = webData.deleted;
      
      const apiResponse = await apiRequest('DELETE', '/api/processed-eclis/clear', { namespace: 'ECLI_NL' });
      const apiData = await apiResponse.json();
      apiDeleted = apiData.deleted;
      
      const totalDeleted = webDeleted + apiDeleted;
      const details = webDeleted > 0 || apiDeleted > 0
        ? ` (WEB_ECLI: ${webDeleted}, ECLI_NL: ${apiDeleted})`
        : '';
      
      toast({
        title: "Database gewist",
        description: `${totalDeleted} verwerkte ECLI's verwijderd uit beide namespaces${details}. Je kunt nu alle records opnieuw uploaden.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij wissen database",
        description: error.message,
      });
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pinecone Export</CardTitle>
        <CardDescription>
          {isChunked 
            ? `Verstuur intelligent gechunkte records naar Pinecone • ${recordCount} chunks klaar`
            : `Verstuur metadata records naar Pinecone (elke Inhoudsindicatie = 1 vector)${recordCount > 0 ? ` • ${recordCount} records klaar` : ''}`
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isChunked && enrichedRecordCount === 0 && recordCount > 0 && (
          <Alert variant="destructive">
            <Info className="h-4 w-4" />
            <AlertDescription>
              <p className="font-semibold">⚠️ Geen AI-verrijkte records gevonden</p>
              <p className="text-sm mt-1">
                Alleen records met AI-gegenereerde samenvattingen kunnen naar Pinecone worden verstuurd om database vervuiling te voorkomen. 
                Gebruik eerst "AI Verrijking Toepassen" om je {recordCount} records te verrijken.
              </p>
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              Stel deze Replit Secrets in voordat je exporteert:
            </p>
            <ul className="text-xs list-disc list-inside space-y-1">
              <li><code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">PINECONE_API_KEY</code> - je Pinecone API key</li>
              <li><code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">VITE_PINECONE_INDEX_HOST</code> - je index host (vult automatisch in)</li>
            </ul>
            <p className="text-xs">
              <strong>Let op:</strong> De app gebruikt Pinecone's Inference API (model: multilingual-e5-large) om automatisch embeddings te genereren uit de Inhoudsindicatie.
            </p>
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="index-host">Pinecone Index Host</Label>
            <Input
              id="index-host"
              type="text"
              placeholder="bijv., rechtstreeks-dmacda9.svc.aped-4627-b74a.pinecone.io"
              value={indexHost}
              onChange={(e) => setIndexHost(e.target.value)}
              data-testid="input-index-host"
            />
            <p className="text-xs text-muted-foreground">
              Te vinden in je Pinecone console onder Index → Connect (ZONDER https://)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Namespace(s)</Label>
            <div className="text-sm font-medium bg-muted px-3 py-2 rounded-md">
              {displayNamespace}
            </div>
            <p className="text-xs text-muted-foreground">
              Standaard namespace voor alle ECLI records
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="batch-size">Batchgrootte</Label>
            <Input
              id="batch-size"
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
              className="max-w-32"
              min="1"
              max="1000"
              data-testid="input-export-batch-size"
            />
            <p className="text-xs text-muted-foreground">
              Aantal records per batch (aanbevolen: 100-500)
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            onClick={handleExport}
            disabled={recordCount === 0 || !indexHost || isExporting || (!isChunked && enrichedRecordCount === 0)}
            className="flex-1"
            data-testid="button-export"
          >
            <Upload className="mr-2 h-4 w-4" />
            {isExporting 
              ? "Bezig met exporteren..." 
              : isChunked 
                ? `${recordCount} Records naar Pinecone Versturen`
                : `${enrichedRecordCount} AI-Verrijkte Records naar Pinecone Versturen`
            }
          </Button>
          
          <Button
            onClick={handleClearProcessedDatabase}
            disabled={isClearing || isExporting}
            variant="outline"
            className="flex-1 sm:flex-none"
            data-testid="button-clear-processed"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {isClearing ? "Wissen..." : "Wis Verwerkte ECLI's Database"}
          </Button>
        </div>

        {exportLogs.length > 0 && (
          <div className="space-y-2">
            <Label>Export Voortgang</Label>
            <ScrollArea className="h-64 rounded-md border bg-muted p-4">
              <div className="font-mono text-xs space-y-1">
                {exportLogs.map((log, idx) => (
                  <div key={idx} className="text-foreground" data-testid={`log-entry-${idx}`}>
                    {log}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
