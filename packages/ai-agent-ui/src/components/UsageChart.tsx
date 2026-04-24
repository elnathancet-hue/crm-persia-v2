"use client";

import * as React from "react";
import type { UsagePoint } from "@persia/shared/ai-agent";

interface Props {
  points: UsagePoint[];
  metric: "cost" | "runs";
}

// Tiny dependency-free SVG bar chart. Avoids pulling recharts just for this.
// Renders fixed 30-day window; missing days render as empty bars so gaps in
// activity stay legible instead of stretching the remaining days.
export function UsageChart({ points, metric }: Props) {
  const values = points.map((p) =>
    metric === "cost" ? p.cost_usd_cents : p.run_count,
  );
  const max = Math.max(1, ...values);

  const formatValue = (v: number) =>
    metric === "cost" ? `US$ ${(v / 100).toFixed(2)}` : `${v} run${v === 1 ? "" : "s"}`;

  return (
    <div className="flex items-end gap-[3px] h-24 w-full" role="img" aria-label={`${metric} por dia`}>
      {points.map((p) => {
        const v = metric === "cost" ? p.cost_usd_cents : p.run_count;
        const pct = (v / max) * 100;
        const tooltip = `${new Date(p.day).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        })}: ${formatValue(v)}`;
        return (
          <div
            key={p.day}
            className="flex-1 min-w-0 flex items-end h-full"
            title={tooltip}
          >
            <div
              className={`w-full rounded-sm transition-colors ${
                v === 0
                  ? "bg-muted"
                  : metric === "cost"
                  ? "bg-gradient-to-t from-purple-500 to-blue-500"
                  : "bg-primary"
              }`}
              style={{ height: v === 0 ? "2px" : `${Math.max(pct, 2)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
