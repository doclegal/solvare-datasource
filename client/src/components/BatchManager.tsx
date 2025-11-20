import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, FolderOpen, Trash2, Clock, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PreparedRecord } from "./RecordPreparation";

interface SavedBatch {
  batchId: string;
  totalRecords: number;
  enrichedRecords: number;
  createdAt: Date;
}

interface BatchManagerProps {
  currentRecords: PreparedRecord[];
  onLoadBatch: (batchId: string, records: PreparedRecord[]) => void;
  onResumeBatch?: (batchId: string, records: PreparedRecord[]) => void;
}

export default function BatchManager({ currentRecords, onLoadBatch, onResumeBatch }: BatchManagerProps) {
  const [savedBatches, setSavedBatches] = useState<SavedBatch[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showBatches, setShowBatches] = useState(false);
  const { toast } = useToast();

  const handleSaveBatch = async () => {
    if (currentRecords.length === 0) {
      toast({
        variant: "destructive",
        title: "Geen records",
        description: "Er zijn geen records om op te slaan",
      });
      return;
    }

    setIsSaving(true);
    try {
      const response = await apiRequest('POST', '/api/batches/save', {
        records: currentRecords,
      });

      const data = await response.json();

      toast({
        title: "Opgeslagen",
        description: data.message,
      });

      // Refresh batch list
      await loadBatchList();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij opslaan",
        description: error.message || "Kon batch niet opslaan",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const loadBatchList = async () => {
    setIsLoading(true);
    try {
      const response = await apiRequest('GET', '/api/batches/list?limit=10');
      const data = await response.json();
      
      // Convert createdAt strings to Date objects
      const batches = data.batches.map((b: any) => ({
        ...b,
        createdAt: new Date(b.createdAt),
      }));
      
      setSavedBatches(batches);
      setShowBatches(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij laden",
        description: error.message || "Kon batches niet ophalen",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadBatch = async (batchId: string) => {
    setIsLoading(true);
    try {
      const response = await apiRequest('GET', `/api/batches/${batchId}`);
      const data = await response.json();

      // CRITICAL: Pass batchId so Home.tsx can prevent duplicate auto-saves
      onLoadBatch(batchId, data.batch.records);

      toast({
        title: "Batch geladen",
        description: `${data.batch.records.length} records geladen`,
      });

      setShowBatches(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij laden",
        description: error.message || "Kon batch niet laden",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResumeBatch = async (batchId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    console.log('🔵 BatchManager handleResumeBatch called');
    console.log('🔵 batchId type:', typeof batchId);
    console.log('🔵 batchId value:', batchId);
    
    if (!onResumeBatch) {
      toast({
        variant: "destructive",
        title: "Niet beschikbaar",
        description: "Resume functionaliteit is niet beschikbaar",
      });
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiRequest('GET', `/api/batches/${batchId}`);
      const data = await response.json();
      
      console.log('🔵 Batch data received:', data);
      console.log('🔵 Records count:', data.batch?.records?.length);
      console.log('🔵 Sample record:', data.batch?.records?.[0]);
      console.log('🔵 Calling onResumeBatch with:', { batchId, recordsCount: data.batch.records.length });

      onResumeBatch(batchId, data.batch.records);

      toast({
        title: "Batch wordt hervat",
        description: `AI verrijking wordt hervat voor ${data.batch.records.length} records`,
      });

      setShowBatches(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij hervatten",
        description: error.message || "Kon batch niet hervatten",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteBatch = async (batchId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (!confirm('Weet je zeker dat je deze batch wilt verwijderen?')) {
      return;
    }

    try {
      await apiRequest('DELETE', `/api/batches/${batchId}`);

      toast({
        title: "Verwijderd",
        description: "Batch succesvol verwijderd",
      });

      // Refresh list
      await loadBatchList();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Fout bij verwijderen",
        description: error.message || "Kon batch niet verwijderen",
      });
    }
  };

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'zojuist';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min geleden`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} uur geleden`;
    return `${Math.floor(seconds / 86400)} dagen geleden`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Batch Opslag</CardTitle>
            <CardDescription>
              Sla je huidige records tijdelijk op (24 uur)
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveBatch}
              disabled={isSaving || currentRecords.length === 0}
              data-testid="button-save-batch"
            >
              <Save className="mr-2 h-4 w-4" />
              {isSaving ? "Bezig..." : "Opslaan"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={loadBatchList}
              disabled={isLoading}
              data-testid="button-load-batches"
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Laden
            </Button>
          </div>
        </div>
      </CardHeader>

      {showBatches && (
        <CardContent>
          {savedBatches.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Geen opgeslagen batches gevonden</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium mb-3">
                {savedBatches.length} opgeslagen batch{savedBatches.length !== 1 ? 'es' : ''}
              </p>
              {savedBatches.map((batch) => {
                const isIncomplete = batch.enrichedRecords < batch.totalRecords;
                const isNotStarted = batch.enrichedRecords === 0;
                
                return (
                  <div
                    key={batch.batchId}
                    className="flex items-center justify-between p-3 border rounded-md hover-elevate cursor-pointer"
                    onClick={() => handleLoadBatch(batch.batchId)}
                    data-testid={`batch-item-${batch.batchId}`}
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="text-sm font-medium flex items-center flex-wrap gap-2">
                          <span>{batch.totalRecords} records</span>
                          {batch.enrichedRecords > 0 && (
                            <Badge variant="secondary">
                              {batch.enrichedRecords} AI-verrijkt
                            </Badge>
                          )}
                          {isNotStarted && (
                            <Badge variant="outline" className="text-blue-600 border-blue-600">
                              Nog niet verrijkt
                            </Badge>
                          )}
                          {isIncomplete && !isNotStarted && (
                            <Badge variant="outline" className="text-amber-600 border-amber-600">
                              Incompleet
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <Clock className="h-3 w-3" />
                          {formatTimeAgo(batch.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isIncomplete && onResumeBatch && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => handleResumeBatch(batch.batchId, e)}
                          data-testid={`button-resume-batch-${batch.batchId}`}
                          className="mr-1"
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Hervat
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteBatch(batch.batchId, e)}
                        data-testid={`button-delete-batch-${batch.batchId}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
