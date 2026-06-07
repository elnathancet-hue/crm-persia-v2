"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mês" },
  { value: "30d", label: "Últimos 30d" },
] as const;

export type PeriodValue = (typeof PERIODS)[number]["value"];

export function PeriodSelector({ current }: { current: PeriodValue }) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => router.push(`?period=${p.value}`)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
            current === p.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
