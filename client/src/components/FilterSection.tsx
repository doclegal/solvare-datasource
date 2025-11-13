import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, RotateCcw } from "lucide-react";
import instantiesData from "@/data/instanties.json";

interface FilterSectionProps {
  onFetch: (filters: FilterParams) => void;
  onReset: () => void;
  isLoading?: boolean;
}

export interface FilterParams {
  batchSize: number;
  dateFrom: string;
  dateTo: string;
  documentType: string;
  court: string;
  legalArea: string;
  fullDocumentsOnly: boolean;
}

export default function FilterSection({ onFetch, onReset, isLoading = false }: FilterSectionProps) {
  const [batchSize, setBatchSize] = useState("50");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [court, setCourt] = useState("");
  const [courtSearch, setCourtSearch] = useState("");
  const [legalArea, setLegalArea] = useState("");
  const [fullDocumentsOnly, setFullDocumentsOnly] = useState(false);

  // Filter instanties based on search
  const filteredInstanties = useMemo(() => {
    if (!courtSearch) return instantiesData;
    
    const searchLower = courtSearch.toLowerCase();
    return instantiesData.filter((inst: any) => 
      inst.naam.toLowerCase().includes(searchLower) ||
      (inst.afkorting && inst.afkorting.toLowerCase().includes(searchLower))
    );
  }, [courtSearch]);

  const handleFetch = () => {
    onFetch({
      batchSize: parseInt(batchSize) || 50,
      dateFrom,
      dateTo,
      documentType,
      court,
      legalArea,
      fullDocumentsOnly,
    });
  };

  const handleReset = () => {
    setBatchSize("50");
    setDateFrom("");
    setDateTo("");
    setDocumentType("");
    setCourt("");
    setCourtSearch("");
    setLegalArea("");
    setFullDocumentsOnly(false);
    onReset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rechtspraak Filters & Ophalen</CardTitle>
        <CardDescription>Stel filters in en haal uitspraken op van de Open Data API</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="batch-size">Aantal resultaten per keer</Label>
            <Input
              id="batch-size"
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
              className="max-w-32"
              min="1"
              max="1000"
              data-testid="input-batch-size"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="date-from">Uitspraakdatum vanaf</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              data-testid="input-date-from"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date-to">Uitspraakdatum tot</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              data-testid="input-date-to"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="document-type">Documenttype</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger id="document-type" data-testid="select-document-type">
                <SelectValue placeholder="Selecteer type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle types</SelectItem>
                <SelectItem value="Uitspraak">Uitspraak</SelectItem>
                <SelectItem value="Conclusie">Conclusie</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="court">Instantie</Label>
            <div className="space-y-2">
              <Input
                id="court-search"
                placeholder="Zoek instantie..."
                value={courtSearch}
                onChange={(e) => setCourtSearch(e.target.value)}
                data-testid="input-court-search"
              />
              <Select value={court} onValueChange={setCourt}>
                <SelectTrigger id="court" data-testid="select-court">
                  <SelectValue placeholder="Selecteer instantie" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="all">Alle instanties</SelectItem>
                  {filteredInstanties.slice(0, 100).map((inst: any, idx: number) => {
                    // Use afkorting if available, otherwise use full identifier
                    // The Rechtspraak API accepts both formats as creator parameter
                    const value = (inst.afkorting && inst.afkorting.trim()) 
                      ? inst.afkorting 
                      : inst.identifier;
                    const displayName = (inst.afkorting && inst.afkorting.trim())
                      ? `${inst.naam} (${inst.afkorting})`
                      : inst.naam;
                    
                    // Skip if value is empty or undefined (SelectItem requires a non-empty value)
                    if (!value || value.trim() === '') {
                      return null;
                    }
                    
                    return (
                      <SelectItem key={inst.identifier || `inst_${idx}`} value={value}>
                        {displayName}
                      </SelectItem>
                    );
                  })}
                  {filteredInstanties.length > 100 && (
                    <SelectItem value="_more_results_" disabled>
                      ... en {filteredInstanties.length - 100} meer. Verfijn je zoekopdracht.
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="legal-area">Rechtsgebied</Label>
            <Select value={legalArea} onValueChange={setLegalArea}>
              <SelectTrigger id="legal-area" data-testid="select-legal-area">
                <SelectValue placeholder="Selecteer rechtsgebied" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle rechtsgebieden</SelectItem>
                <SelectItem value="http://psi.rechtspraak.nl/rechtsgebied#civielRecht">Civiel recht</SelectItem>
                <SelectItem value="http://psi.rechtspraak.nl/rechtsgebied#strafRecht">Strafrecht</SelectItem>
                <SelectItem value="http://psi.rechtspraak.nl/rechtsgebied#bestuursRecht">Bestuursrecht</SelectItem>
                <SelectItem value="http://psi.rechtspraak.nl/rechtsgebied#EuropeesRecht">Europees recht</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="full-docs"
            checked={fullDocumentsOnly}
            onCheckedChange={(checked) => setFullDocumentsOnly(checked as boolean)}
            data-testid="checkbox-full-docs"
          />
          <Label htmlFor="full-docs" className="text-sm font-normal cursor-pointer">
            Alleen uitspraken met volledige documenten beschikbaar
          </Label>
        </div>

        <div className="flex gap-3 pt-2">
          <Button onClick={handleFetch} disabled={isLoading} className="flex-1 md:flex-initial" data-testid="button-fetch">
            <Search className="mr-2 h-4 w-4" />
            {isLoading ? "Bezig met ophalen..." : "Uitspraken Ophalen"}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={isLoading} data-testid="button-reset">
            <RotateCcw className="mr-2 h-4 w-4" />
            Filters Resetten
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
