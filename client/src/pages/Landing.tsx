import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Scale, BookOpen, MapPin, FileText } from "lucide-react";

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

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link href="/wetgeving">
            <Card 
              className="cursor-pointer transition-all hover-elevate h-full"
              data-testid="card-wetgeving"
            >
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
                  <BookOpen className="h-10 w-10 text-primary" />
                </div>
                <CardTitle className="text-lg">Wetgeving</CardTitle>
                <CardDescription className="text-sm">
                  Nationale wetgeving
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-muted-foreground">
                <ul className="space-y-1 text-xs">
                  <li>Wetten en besluiten</li>
                  <li>Ministeriële regelingen</li>
                </ul>
                <div className="mt-3 text-xs text-green-600 dark:text-green-400">
                  Beschikbaar
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/lokale-regelgeving">
            <Card 
              className="cursor-pointer transition-all hover-elevate h-full"
              data-testid="card-lokale-regelgeving"
            >
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
                  <MapPin className="h-10 w-10 text-primary" />
                </div>
                <CardTitle className="text-lg">Lokale Regelgeving</CardTitle>
                <CardDescription className="text-sm">
                  CVDR verordeningen
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-muted-foreground">
                <ul className="space-y-1 text-xs">
                  <li>Provinciale verordeningen</li>
                  <li>Gemeentelijke regelgeving</li>
                </ul>
                <div className="mt-3 text-xs text-green-600 dark:text-green-400">
                  Beschikbaar
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/omgevingsplannen">
            <Card 
              className="cursor-pointer transition-all hover-elevate h-full"
              data-testid="card-omgevingsplannen"
            >
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
                  <FileText className="h-10 w-10 text-primary" />
                </div>
                <CardTitle className="text-lg">Omgevingsplannen</CardTitle>
                <CardDescription className="text-sm">
                  DSO-LV documenten
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-muted-foreground">
                <ul className="space-y-1 text-xs">
                  <li>Omgevingsplannen</li>
                  <li>Omgevingsvisies</li>
                </ul>
                <div className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                  API-key vereist
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/rechtspraak">
            <Card 
              className="cursor-pointer transition-all hover-elevate h-full"
              data-testid="card-rechtspraak"
            >
              <CardHeader className="text-center pb-2">
                <div className="mx-auto mb-4 p-4 rounded-full bg-primary/10">
                  <Scale className="h-10 w-10 text-primary" />
                </div>
                <CardTitle className="text-lg">Rechtspraak</CardTitle>
                <CardDescription className="text-sm">
                  Rechtspraak.nl
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-muted-foreground">
                <ul className="space-y-1 text-xs">
                  <li>Civiele uitspraken</li>
                  <li>AI-verrijking</li>
                </ul>
                <div className="mt-3 text-xs text-green-600 dark:text-green-400">
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
