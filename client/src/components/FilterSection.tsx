import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RotateCcw } from "lucide-react";
import civilSubcategoriesData from "@/data/civil-subcategories.json";

interface FilterSectionProps {
  onFetch: (filters: FilterParams) => void;
  onReset: () => void;
  isLoading?: boolean;
}

export interface FilterParams {
  batchSize: number;
  datePeriod: string;
  year?: number; // NEW: Specific year filtering
  month?: number; // NEW: Specific month (1-12)
  court: string;
  civilSubcategory: string;
  fullDocumentsOnly: boolean;
}

const datePeriodOptions = [
  { value: "10years", label: "Afgelopen tien jaar" },
  { value: "5years", label: "Afgelopen vijf jaar" },
  { value: "1year", label: "Afgelopen jaar" },
  { value: "1month", label: "Afgelopen maand" },
  { value: "1week", label: "Afgelopen week" },
];

export default function FilterSection({ onFetch, onReset, isLoading = false }: FilterSectionProps) {
  const [batchSize, setBatchSize] = useState("50");
  const [datePeriod, setDatePeriod] = useState("10years");
  const [civilSubcategory, setCivilSubcategory] = useState("all");
  // NEW: Year/Month specific filtering
  const [selectedYear, setSelectedYear] = useState<string>("none");
  const [selectedMonth, setSelectedMonth] = useState<string>("none");

  const handleFetch = () => {
    onFetch({
      batchSize: parseInt(batchSize) || 50,
      datePeriod,
      // NEW: Pass year/month if selected (takes precedence over datePeriod)
      year: selectedYear !== "none" ? parseInt(selectedYear) : undefined,
      month: selectedMonth !== "none" ? parseInt(selectedMonth) : undefined,
      court: "all", // Always search all courts (Rechtbanken, Gerechtshoven, Hoge Raad)
      civilSubcategory,
      fullDocumentsOnly: true, // Always filter for full documents
    });
  };

  const handleReset = () => {
    setBatchSize("50");
    setDatePeriod("10years");
    setCivilSubcategory("all");
    setSelectedYear("none");
    setSelectedMonth("none");
    onReset();
  };

  // Generate year options (2010-2025)
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = [{ value: "none", label: "Geen specifiek jaar" }];
    for (let year = currentYear; year >= 2010; year--) {
      years.push({ value: year.toString(), label: year.toString() });
    }
    return years;
  }, []);

  // Month options (1-12)
  const monthOptions = [
    { value: "none", label: "Hele jaar" },
    { value: "1", label: "Januari" },
    { value: "2", label: "Februari" },
    { value: "3", label: "Maart" },
    { value: "4", label: "April" },
    { value: "5", label: "Mei" },
    { value: "6", label: "Juni" },
    { value: "7", label: "Juli" },
    { value: "8", label: "Augustus" },
    { value: "9", label: "September" },
    { value: "10", label: "Oktober" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

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

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">📅 Datum Filtering (kies één methode)</Label>
            <p className="text-xs text-muted-foreground">
              <strong>Methode 1:</strong> Specifiek jaar/maand (bijv. Januari 2024, OF heel 2024)<br />
              <strong>Methode 2:</strong> Relatieve periode (bijv. "laatste 10 jaar")
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="year-select">Jaar (Methode 1)</Label>
              <Select value={selectedYear} onValueChange={(value) => {
                setSelectedYear(value);
                // Reset month when year is cleared
                if (value === "none") {
                  setSelectedMonth("none");
                }
              }}>
                <SelectTrigger id="year-select" data-testid="select-year">
                  <SelectValue placeholder="Selecteer jaar" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {yearOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="month-select">Maand (laat "Hele jaar" voor volledig jaar)</Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth} disabled={selectedYear === "none"}>
                <SelectTrigger id="month-select" data-testid="select-month">
                  <SelectValue placeholder="Hele jaar" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {monthOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date-period">Periode (Methode 2)</Label>
              <p className="text-xs text-muted-foreground mb-1">
                Alleen gebruikt als geen specifiek jaar gekozen
              </p>
              <Select value={datePeriod} onValueChange={setDatePeriod} disabled={selectedYear !== "none"}>
                <SelectTrigger id="date-period" data-testid="select-date-period" className={selectedYear !== "none" ? "opacity-50" : ""}>
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
