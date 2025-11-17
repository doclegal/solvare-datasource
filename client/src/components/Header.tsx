import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface HeaderProps {
  isConnected?: boolean;
}

export default function Header({ isConnected = true }: HeaderProps) {
  const [isUpdating, setIsUpdating] = useState(false);
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
