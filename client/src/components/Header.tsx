import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  isConnected?: boolean;
}

export default function Header({ isConnected = true }: HeaderProps) {
  return (
    <header className="border-b bg-card h-16 flex items-center justify-between px-8">
      <div>
        <h1 className="text-2xl font-medium">Rechtspraak Ingestie Tool</h1>
        <p className="text-sm text-muted-foreground">Nederlandse Uitspraken → Pinecone Vector Opslag</p>
      </div>
      <Badge 
        variant={isConnected ? "default" : "secondary"}
        data-testid="badge-connection-status"
      >
        {isConnected ? "Klaar" : "Niet Verbonden"}
      </Badge>
    </header>
  );
}
