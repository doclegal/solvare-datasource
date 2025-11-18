import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function UploadedEcliList() {
  const { data, isLoading } = useQuery({
    queryKey: ['/api/processed-eclis/list'],
  });

  const eclis = data?.eclis || [];
  const count = data?.count || 0;

  return (
    <Card className="h-full" data-testid="card-uploaded-eclis">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Verzonden naar Pinecone</CardTitle>
          <Badge variant="secondary" data-testid="badge-ecli-count">
            {count}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground" data-testid="text-loading">
            Laden...
          </div>
        ) : count === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="text-empty">
            Nog geen records verzonden
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-1">
              {eclis.map((ecli: string, index: number) => (
                <div
                  key={`${ecli}-${index}`}
                  className="text-xs font-mono text-muted-foreground py-0.5"
                  data-testid={`ecli-item-${index}`}
                >
                  {ecli}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
