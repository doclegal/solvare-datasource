import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RotateCcw } from "lucide-react";
import instantiesData from "@/data/instanties.json";
import civilSubcategoriesData from "@/data/civil-subcategories.json";

interface FilterSectionProps {
  onFetch: (filters: FilterParams) => void;
  onReset: () => void;
  isLoading?: boolean;
}

export interface FilterParams {
  batchSize: number;
  datePeriod: string;
  court: string;
  civilSubcategory: string;
  fullDocumentsOnly: boolean;
}

const datePeriodOptions = [
  { value: "all", label: "Alles" },
  { value: "10years", label: "Afgelopen tien jaar" },
  { value: "5years", label: "Afgelopen vijf jaar" },
  { value: "1year", label: "Afgelopen jaar" },
  { value: "1month", label: "Afgelopen maand" },
  { value: "1week", label: "Afgelopen week" },
];

export default function FilterSection({ onFetch, onReset, isLoading = false }: FilterSectionProps) {
  const [batchSize, setBatchSize] = useState("50");
  const [datePeriod, setDatePeriod] = useState("all");
  const [court, setCourt] = useState("");
  const [civilSubcategory, setCivilSubcategory] = useState("all");

  const handleFetch = () => {
    onFetch({
      batchSize: parseInt(batchSize) || 50,
      datePeriod,
      court,
      civilSubcategory,
      fullDocumentsOnly: true, // Always filter for full documents
    });
  };

  const handleReset = () => {
    setBatchSize("50");
    setDatePeriod("all");
    setCourt("");
    setCivilSubcategory("all");
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
            <Label htmlFor="date-period">Periode</Label>
            <Select value={datePeriod} onValueChange={setDatePeriod}>
              <SelectTrigger id="date-period" data-testid="select-date-period">
                <SelectValue placeholder="Selecteer periode" />
              </SelectTrigger>
              <SelectContent>
                {datePeriodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="civil-subcategory">Type civiele zaak</Label>
            <Select value={civilSubcategory} onValueChange={setCivilSubcategory}>
              <SelectTrigger id="civil-subcategory" data-testid="select-civil-subcategory">
                <SelectValue placeholder="Selecteer type zaak" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {civilSubcategoriesData.map((cat: any) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
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
