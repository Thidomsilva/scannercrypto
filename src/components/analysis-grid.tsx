"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalysisGridProps {
  pairs: string[];
  currentlyAnalyzing: string | null;
  statusText?: string;
}

const getPairName = (pair: string) => pair.split('/')[0];

export function AnalysisGrid({ pairs, currentlyAnalyzing, statusText }: AnalysisGridProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 rounded-lg border bg-secondary/50 min-h-[170px] space-y-4">
      <div className="grid grid-cols-3 gap-3 w-full">
        {pairs.map((pair) => (
          <div
            key={pair}
            className={cn(
              "flex items-center justify-center p-2 rounded-md text-xs font-semibold transition-all duration-300",
              currentlyAnalyzing === pair
                ? "bg-primary/80 text-primary-foreground scale-110 shadow-lg"
                : "bg-background/50 text-muted-foreground"
            )}
          >
            {getPairName(pair)}
          </div>
        ))}
      </div>
      <div className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span>{statusText || "Iniciando varredura..."}</span>
      </div>
    </div>
  );
}
