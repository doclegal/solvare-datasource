import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface EcliRecord {
  ecli: string;
  title: string;
  court: string;
  decisionDate: string;
}

interface EcliTableProps {
  records: EcliRecord[];
  currentPage: number;
  totalResults: number;
  onLoadMore: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClear: () => void;
  isLoading?: boolean;
}

export default function EcliTable({
  records,
  currentPage,
  totalResults,
  onLoadMore,
  onPrevious,
  onNext,
  onClear,
  isLoading = false,
}: EcliTableProps) {
  const resultsPerPage = 50;
  const startIndex = (currentPage - 1) * resultsPerPage + 1;
  const endIndex = Math.min(currentPage * resultsPerPage, records.length);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>ECLI Results</CardTitle>
            <CardDescription>
              {records.length > 0 
                ? `Showing ${startIndex}-${endIndex} of ${records.length} fetched decisions${totalResults > records.length ? ` (${totalResults} total available)` : ''}`
                : "No decisions fetched yet"
              }
            </CardDescription>
          </div>
          {records.length > 0 && (
            <Button variant="outline" size="sm" onClick={onClear} data-testid="button-clear-ecli">
              <Trash2 className="mr-2 h-4 w-4" />
              Clear List
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Use the filter section above to fetch court decisions</p>
          </div>
        ) : (
          <div className="space-y-4">
            <ScrollArea className="h-[400px] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[280px]">ECLI</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-[200px]">Court</TableHead>
                    <TableHead className="w-[120px]">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record, idx) => (
                    <TableRow key={record.ecli} data-testid={`row-ecli-${idx}`}>
                      <TableCell className="font-mono text-sm">{record.ecli}</TableCell>
                      <TableCell>{record.title}</TableCell>
                      <TableCell>{record.court}</TableCell>
                      <TableCell>{record.decisionDate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>

            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={onPrevious}
                disabled={currentPage <= 1 || isLoading}
                data-testid="button-previous"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              
              <Badge variant="secondary" data-testid="text-page-info">
                Page {currentPage}
              </Badge>

              <Button
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={isLoading}
                data-testid="button-load-more"
              >
                {isLoading ? "Loading..." : "Load More"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={onNext}
                disabled={isLoading}
                data-testid="button-next"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
