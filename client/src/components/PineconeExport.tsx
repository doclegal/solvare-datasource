import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Info } from "lucide-react";

interface PineconeExportProps {
  recordCount: number;
  onExport: (config: ExportConfig) => void;
  isExporting?: boolean;
  exportLogs?: string[];
}

export interface ExportConfig {
  indexHost: string;
  namespace: string;
  batchSize: number;
}

export default function PineconeExport({
  recordCount,
  onExport,
  isExporting = false,
  exportLogs = [],
}: PineconeExportProps) {
  const [indexHost, setIndexHost] = useState("");
  const [namespace, setNamespace] = useState("");
  const [batchSize, setBatchSize] = useState("100");

  const handleExport = () => {
    onExport({
      indexHost,
      namespace,
      batchSize: parseInt(batchSize) || 100,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pinecone Export</CardTitle>
        <CardDescription>
          Verstuur voorbereide records naar je Pinecone vector database
          {recordCount > 0 && ` • ${recordCount} records klaar`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              Zorg ervoor dat je <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">PINECONE_API_KEY</code> in je Replit Secrets hebt ingesteld voordat je exporteert.
            </p>
            <p className="text-xs">
              <strong>Let op:</strong> De app gebruikt Pinecone's Inference API (model: multilingual-e5-large) om automatisch embeddings te genereren. Dit wordt meegerekend in je Pinecone usage.
            </p>
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="index-host">Pinecone Index Host</Label>
            <Input
              id="index-host"
              type="text"
              placeholder="bijv., my-index-abc123.svc.apw5-4e34-81fa.pinecone.io"
              value={indexHost}
              onChange={(e) => setIndexHost(e.target.value)}
              data-testid="input-index-host"
            />
            <p className="text-xs text-muted-foreground">
              Te vinden in je Pinecone console onder Index → Connect
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="namespace">Namespace (optioneel)</Label>
            <Input
              id="namespace"
              type="text"
              placeholder="bijv., rechtspraak-uitspraken"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              data-testid="input-namespace"
            />
            <p className="text-xs text-muted-foreground">
              Gebruik namespaces om vectors binnen je index te organiseren
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

        <Button
          onClick={handleExport}
          disabled={recordCount === 0 || !indexHost || isExporting}
          className="w-full md:w-auto"
          data-testid="button-export"
        >
          <Upload className="mr-2 h-4 w-4" />
          {isExporting ? "Bezig met exporteren..." : `${recordCount} Records naar Pinecone Versturen`}
        </Button>

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
