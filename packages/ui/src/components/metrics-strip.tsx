"use client";

import * as React from "react";
import { cn } from "../utils";
import { KpiValue, MutedHint, SectionLabel } from "./typography";
import type { MetricTone } from "./metric-card";

const METRIC_STRIP_TONE_CLASSES: Record<MetricTone, string> = {
  default: "text-foreground",
  success: "text-success",
  failure: "text-failure",
  progress: "text-progress",
  warning: "text-warning",
};

export interface MetricsStripItem {
  label: React.ReactNode;
  value: React.ReactNode;
  helper?: React.ReactNode;
  tone?: MetricTone;
}

export interface MetricsStripProps extends React.HTMLAttributes<HTMLDivElement> {
  items: MetricsStripItem[];
}

export function MetricsStrip({ items, className, ...props }: MetricsStripProps) {
  if (items.length === 0) return null;

  return (
    <div
      data-slot="metrics-strip"
      className={cn(
        "grid gap-2 rounded-xl border border-border bg-muted/25 p-2 sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
      {...props}
    >
      {items.map((item, index) => {
        const tone = item.tone ?? "default";
        return (
          <div key={index} className="min-w-0 rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/5">
            <SectionLabel as="p" className="truncate text-[10px]">
              {item.label}
            </SectionLabel>
            <KpiValue size="sm" className={cn("mt-1", METRIC_STRIP_TONE_CLASSES[tone])}>
              {item.value}
            </KpiValue>
            {item.helper && (
              <MutedHint className="mt-1 truncate text-xs">
                {item.helper}
              </MutedHint>
            )}
          </div>
        );
      })}
    </div>
  );
}

