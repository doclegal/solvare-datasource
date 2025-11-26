import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Scale, BookOpen } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Juridische Databronnen
          </h1>
          <p className="text-lg text-muted-foreground">
            Upload en verwerk juridische documenten naar Pinecone voor semantisch zoeken
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Link href="/wetgeving">
            <Card 
              className="cursor-pointer transition-all hover-elevate h-full"
              data-testid="card-wetgeving"
            >
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
                  <BookOpen className="h-12 w-12 text-primary" />
                </div>
                <CardTitle className="text-2xl">Wetgeving Uploaden</CardTitle>
                <CardDescription className="text-base">
                  Upload Nederlandse wetgeving en regelgeving naar Pinecone
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-muted-foreground">
                <ul className="space-y-2 text-sm">
                  <li>Wetten en besluiten</li>
                  <li>Ministeriële regelingen</li>
                  <li>Europese verordeningen</li>
                </ul>
                <div className="mt-4 text-xs text-green-600 dark:text-green-400">
                  Beschikbaar
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/rechtspraak">
            <Card 
              className="cursor-pointer transition-all hover-elevate h-full border-primary/50"
              data-testid="card-rechtspraak"
            >
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
                  <Scale className="h-12 w-12 text-primary" />
                </div>
                <CardTitle className="text-2xl">Rechtspraak Uploaden</CardTitle>
                <CardDescription className="text-base">
                  Haal uitspraken op van Rechtspraak.nl en upload naar Pinecone
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-muted-foreground">
                <ul className="space-y-2 text-sm">
                  <li>Civielrechtelijke uitspraken</li>
                  <li>AI-verrijking met GPT-3.5</li>
                  <li>Automatische duplicate detectie</li>
                </ul>
                <div className="mt-4 text-xs text-green-600 dark:text-green-400">
                  Beschikbaar
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        <div className="text-center mt-12 text-sm text-muted-foreground">
          <p>Selecteer een optie om te beginnen</p>
        </div>
      </div>
    </div>
  );
}
