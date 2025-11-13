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
          Send prepared records to your Pinecone vector database
          {recordCount > 0 && ` • ${recordCount} records ready`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Make sure to set <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">PINECONE_API_KEY</code> in your Replit Secrets before exporting.
            The API key is required to authenticate with Pinecone.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="index-host">Pinecone Index Host</Label>
            <Input
              id="index-host"
              type="text"
              placeholder="e.g., my-index-abc123.svc.apw5-4e34-81fa.pinecone.io"
              value={indexHost}
              onChange={(e) => setIndexHost(e.target.value)}
              data-testid="input-index-host"
            />
            <p className="text-xs text-muted-foreground">
              Find this in your Pinecone console under Index → Connect
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="namespace">Namespace (optional)</Label>
            <Input
              id="namespace"
              type="text"
              placeholder="e.g., rechtspraak-decisions"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              data-testid="input-namespace"
            />
            <p className="text-xs text-muted-foreground">
              Use namespaces to organize vectors within your index
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="batch-size">Batch Size</Label>
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
              Number of records to send per batch (recommended: 100-500)
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
          {isExporting ? "Exporting..." : `Send ${recordCount} Records to Pinecone`}
        </Button>

        {exportLogs.length > 0 && (
          <div className="space-y-2">
            <Label>Export Progress</Label>
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
