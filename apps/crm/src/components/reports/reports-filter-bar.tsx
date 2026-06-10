"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { FileDown, X } from "lucide-react";
import { Button } from "@persia/ui/button";

interface ReportsFilterBarProps {
  from?: string;
  to?: string;
}

export function ReportsFilterBar({ from, to }: ReportsFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => {
        router.replace(`/reports?${params.toString()}`, { scroll: false });
      });
    },
    [router, searchParams],
  );

  const clearFilters = useCallback(() => {
    startTransition(() => {
      router.replace("/reports", { scroll: false });
    });
  }, [router]);

  const hasFilter = !!(from || to);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground shrink-0">De</label>
        <input
          type="date"
          defaultValue={from ?? ""}
          onChange={(e) => updateParam("from", e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground shrink-0">Até</label>
        <input
          type="date"
          defaultValue={to ?? ""}
          onChange={(e) => updateParam("to", e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {hasFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="h-8 gap-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
          Limpar
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 print:hidden"
        onClick={() => window.print()}
      >
        <FileDown className="size-3.5" />
        PDF
      </Button>
    </div>
  );
}
