import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { BookOpen, ArrowLeft, Construction } from "lucide-react";

export default function Wetgeving() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        <Link href="/">
          <Button variant="ghost" className="mb-6" data-testid="button-back-home">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Terug naar startpagina
          </Button>
        </Link>

        <Card className="text-center" data-testid="card-wetgeving-placeholder">
          <CardHeader>
            <div className="mx-auto mb-4 p-4 rounded-full bg-amber-500/10">
              <Construction className="h-16 w-16 text-amber-500" />
            </div>
            <CardTitle className="text-3xl flex items-center justify-center gap-3">
              <BookOpen className="h-8 w-8" />
              Wetgeving Uploaden
            </CardTitle>
            <CardDescription className="text-lg">
              Deze functionaliteit is nog in ontwikkeling
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-muted-foreground">
              Binnenkort kun je hier Nederlandse wetgeving en regelgeving uploaden naar Pinecone 
              voor semantisch zoeken.
            </p>
            
            <div className="bg-muted/50 rounded-lg p-4 text-left">
              <h3 className="font-semibold mb-2">Geplande functies:</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• Ophalen van wetten van wetten.overheid.nl</li>
                <li>• Automatische structuurherkenning</li>
                <li>• AI-verrijking van wetsartikelen</li>
                <li>• Upload naar Pinecone WETGEVING namespace</li>
              </ul>
            </div>

            <Link href="/rechtspraak">
              <Button className="w-full" data-testid="button-go-rechtspraak">
                Ga naar Rechtspraak Uploaden
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
