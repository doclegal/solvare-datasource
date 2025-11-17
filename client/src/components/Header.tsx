import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface HeaderProps {
  isConnected?: boolean;
}

export default function Header({ isConnected = true }: HeaderProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const handleUpdateCourtLevels = async () => {
    setIsUpdating(true);
    try {
      const response = await fetch('/api/pinecone/update-court-levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Update mislukt');
      }

      toast({
        title: 'Court Level Update Voltooid',
        description: `${result.updated} records bijgewerkt (${result.enriched} met AI, ${result.baseline} basis)`,
      });
    } catch (error: any) {
      console.error('[Court Level Update] Error:', error);
      toast({
        title: 'Fout bij Court Level Update',
        description: error.message || 'Er is een fout opgetreden',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteWithoutAI = async () => {
    setIsDeleting(true);
    try {
      // First, get preview
      const previewResponse = await fetch('/api/pinecone/delete-without-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      });

      const preview = await previewResponse.json();

      if (!previewResponse.ok) {
        throw new Error(preview.error || 'Preview mislukt');
      }

      // Ask for confirmation
      const confirmed = window.confirm(
        `${preview.count} van ${preview.total} records hebben GEEN AI samenvatting.\n\n` +
        `Deze records worden permanent verwijderd uit Pinecone.\n\n` +
        `Voorbeeld ECLIs:\n${preview.preview?.slice(0, 5).join('\n') || 'Geen preview'}\n\n` +
        `Doorgaan met verwijderen?`
      );

      if (!confirmed) {
        toast({
          title: 'Geannuleerd',
          description: 'Geen records verwijderd',
        });
        return;
      }

      // Proceed with deletion
      const deleteResponse = await fetch('/api/pinecone/delete-without-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });

      const result = await deleteResponse.json();

      if (!deleteResponse.ok) {
        throw new Error(result.error || 'Delete mislukt');
      }

      toast({
        title: 'Records Verwijderd',
        description: `${result.deleted} records zonder AI samenvatting verwijderd (${result.remaining} records over)`,
      });
    } catch (error: any) {
      console.error('[Delete Without AI] Error:', error);
      toast({
        title: 'Fout bij Verwijderen',
        description: error.message || 'Er is een fout opgetreden',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <header className="border-b bg-card h-16 flex items-center justify-between px-8">
      <div>
        <h1 className="text-2xl font-medium">Rechtspraak Ingestie Tool</h1>
        <p className="text-sm text-muted-foreground">Nederlandse Uitspraken → Pinecone Vector Opslag</p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDeleteWithoutAI}
          disabled={isDeleting}
          data-testid="button-delete-without-ai"
        >
          <Trash2 className={`w-4 h-4 mr-2 ${isDeleting ? 'animate-pulse' : ''}`} />
          {isDeleting ? 'Verwijderen...' : 'Verwijder Zonder AI'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpdateCourtLevels}
          disabled={isUpdating}
          data-testid="button-update-court-levels"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isUpdating ? 'animate-spin' : ''}`} />
          {isUpdating ? 'Updaten...' : 'Update Court Levels'}
        </Button>
        <Badge 
          variant={isConnected ? "default" : "secondary"}
          data-testid="badge-connection-status"
        >
          {isConnected ? "Klaar" : "Niet Verbonden"}
        </Badge>
      </div>
    </header>
  );
}
