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

      // Check if there are any records to delete
      if (preview.count === 0) {
        toast({
          title: 'Geen Records om te Verwijderen',
          description: 'Alle records hebben al een AI samenvatting',
        });
        return;
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

      // Check if deletion was verified
      if (!result.verified) {
        toast({
          title: 'Waarschuwing: Verificatie Mislukt',
          description: `${result.deleted} records verwijderd maar verificatie faalde. Check server logs.`,
          variant: 'destructive',
        });
      } else if (result.errors && result.errors.length > 0) {
        toast({
          title: 'Deels Gelukt',
          description: `${result.deleted} records verwijderd met ${result.errors.length} errors. Check server logs.`,
        });
      } else {
        toast({
          title: 'Records Verwijderd',
          description: `${result.deleted} records zonder AI samenvatting verwijderd (${result.remaining} records over)`,
        });
      }
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
    <header className="border-b bg-card h-16 flex items-center justify-between px-4 md:px-8">
      <div className="min-w-0 flex-shrink">
        <h1 className="text-lg md:text-2xl font-medium truncate">Rechtspraak Ingestie Tool</h1>
        <p className="text-xs md:text-sm text-muted-foreground truncate">Nederlandse Uitspraken → Pinecone Vector Opslag</p>
      </div>
      <div className="flex items-center gap-1 md:gap-3 flex-shrink-0">
        <Button
          variant="outline"
          size="icon"
          onClick={handleDeleteWithoutAI}
          disabled={isDeleting}
          data-testid="button-delete-without-ai"
          className="md:hidden"
          title="Verwijder Zonder AI"
        >
          <Trash2 className={`w-4 h-4 ${isDeleting ? 'animate-pulse' : ''}`} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDeleteWithoutAI}
          disabled={isDeleting}
          data-testid="button-delete-without-ai-desktop"
          className="hidden md:flex"
        >
          <Trash2 className={`w-4 h-4 mr-2 ${isDeleting ? 'animate-pulse' : ''}`} />
          {isDeleting ? 'Verwijderen...' : 'Verwijder Zonder AI'}
        </Button>
        
        <Button
          variant="outline"
          size="icon"
          onClick={handleUpdateCourtLevels}
          disabled={isUpdating}
          data-testid="button-update-court-levels"
          className="md:hidden"
          title="Update Court Levels"
        >
          <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpdateCourtLevels}
          disabled={isUpdating}
          data-testid="button-update-court-levels-desktop"
          className="hidden md:flex"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isUpdating ? 'animate-spin' : ''}`} />
          {isUpdating ? 'Updaten...' : 'Update Court Levels'}
        </Button>
        
        <Badge 
          variant={isConnected ? "default" : "secondary"}
          data-testid="badge-connection-status"
          className="hidden md:inline-flex"
        >
          {isConnected ? "Klaar" : "Niet Verbonden"}
        </Badge>
      </div>
    </header>
  );
}
