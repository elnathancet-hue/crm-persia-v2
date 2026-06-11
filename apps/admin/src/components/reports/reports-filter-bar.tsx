"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { FileDown, X } from "lucide-react";

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
          className="h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground shrink-0">Até</label>
        <input
          type="date"
          defaultValue={to ?? ""}
          onChange={(e) => updateParam("to", e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      {hasFilter && (
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 h-8 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-card border border-transparent hover:border-border transition-colors"
        >
          <X className="size-3.5" />
          Limpar
        </button>
      )}
      <button
        className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs text-muted-foreground border border-border bg-card hover:text-foreground transition-colors print:hidden"
        onClick={() => window.print()}
      >
        <FileDown className="size-3.5" />
        PDF
      </button>
    </div>
  );
}
