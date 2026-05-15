"use client";

// MetricCard — card padronizado pra KPI/metrica.
//
// PR-AUDIT (mai/2026): KpiCard existia em apps/crm/src/components/dashboard/
// mas era especifico do dashboard. Outras telas (reports, /crm header,
// drawer stats) reimplementavam o pattern com border rounded-xl p-6
// manual + label + value + icon. Drift de tamanhos, ring, padding,
// hierarchy.
//
// Agora 1 primitive consolidado. Usa <Card> base + tokens semanticos.
//
// Uso basico:
//   <MetricCard label="LEADS NOVOS (7D)" value={42} icon={Users} />
//
// Com tone (cor da metrica via outcome token):
//   <MetricCard label="GANHOS" value="R$ 12.5k" tone="success" icon={DollarSign} />
//
// Com helper subtitle:
//   <MetricCard
//     label="TAXA DA IA"
//     value="78%"
//     helper="+4% vs semana passada"
//     tone="success"
//   />

import * as React from "react";
import { Card, CardContent } from "./card";
import { KpiValue, SectionLabel, MutedHint } from "./typography";
import { cn } from "../utils";

export type MetricTone = "default" | "success" | "failure" | "progress" | "warning";

export interface MetricCardProps {
  /** Label uppercase em cima (vai virar <SectionLabel>). */
  label: React.ReactNode;
  /** Valor principal (numero ou string formatada). */
  value: React.ReactNode;
  /** Texto helper abaixo do valor (tendencia, periodo, etc). */
  helper?: React.ReactNode;
  /** Icone Lucide pra direita superior. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Cor semantica do valor + icone. Default neutro. */
  tone?: MetricTone;
  /** Tamanho do valor. Default md. */
  valueSize?: "sm" | "md" | "lg";
  className?: string;
}

const TONE_VALUE_CLASSES: Record<MetricTone, string> = {
  default: "text-foreground",
  success: "text-success",
  failure: "text-failure",
  progress: "text-progress",
  warning: "text-warning",
};

const TONE_ICON_BG: Record<MetricTone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  failure: "bg-failure-soft text-failure",
  progress: "bg-progress-soft text-progress",
  warning: "bg-warning-soft text-warning",
};

export function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = "default",
  valueSize = "md",
  className,
}: MetricCardProps) {
  return (
    <Card className={className}>
      <CardContent className="p-card flex items-start justify-between gap-stack">
        <div className="min-w-0 space-y-2">
          <SectionLabel as="p">{label}</SectionLabel>
          <KpiValue size={valueSize} className={TONE_VALUE_CLASSES[tone]}>
            {value}
          </KpiValue>
          {helper && <MutedHint className="text-xs">{helper}</MutedHint>}
        </div>
        {Icon && (
          <div
            className={cn(
              "size-10 rounded-xl flex items-center justify-center shrink-0",
              TONE_ICON_BG[tone],
            )}
          >
            <Icon className="size-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
