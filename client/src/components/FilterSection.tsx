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
  court: string;
  fullDocumentsOnly: boolean;
}

export default function FilterSection({ onFetch, onReset, isLoading = false }: FilterSectionProps) {
  const [batchSize, setBatchSize] = useState("50");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [court, setCourt] = useState("");
  const [fullDocumentsOnly, setFullDocumentsOnly] = useState(false);

  const handleFetch = () => {
    onFetch({
      batchSize: parseInt(batchSize) || 50,
      dateFrom,
      dateTo,
      court,
      fullDocumentsOnly,
    });
  };

  const handleReset = () => {
    setBatchSize("50");
    setDateFrom("");
    setDateTo("");
    setCourt("");
    setFullDocumentsOnly(false);
    onReset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Civielrecht Uitspraken Ophalen</CardTitle>
        <CardDescription>Haal civielrechtelijke uitspraken op van rechtbanken, gerechtshoven en Hoge Raad</CardDescription>
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

        <div className="space-y-2">
          <Label htmlFor="court">Instantie</Label>
          <Select value={court} onValueChange={setCourt}>
            <SelectTrigger id="court" data-testid="select-court">
              <SelectValue placeholder="Selecteer instantie" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">Alle instanties</SelectItem>
              {instantiesData.map((inst: any, idx: number) => {
                const value = (inst.afkorting && inst.afkorting.trim()) 
                  ? inst.afkorting 
                  : inst.identifier;
                const displayName = (inst.afkorting && inst.afkorting.trim())
                  ? `${inst.naam} (${inst.afkorting})`
                  : inst.naam;
                
                if (!value || value.trim() === '') {
                  return null;
                }
                
                return (
                  <SelectItem key={inst.identifier || `inst_${idx}`} value={value}>
                    {displayName}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
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
