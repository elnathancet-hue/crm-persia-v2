import { Activity, CheckCircle2, Clock, TriangleAlert } from "lucide-react";
import type { UsagePointTotals } from "@persia/shared/ai-agent";
import { Card, CardContent } from "@persia/ui/card";

interface Props {
  totals: UsagePointTotals;
}

export function UsageStatsCards({ totals }: Props) {
  const cards = [
    {
      label: "Execuções",
      value: totals.run_count.toLocaleString("pt-BR"),
      sub: `${totals.succeeded_count} sucesso / ${totals.failed_count} falha`,
      icon: Activity,
      color: "text-primary",
    },
    {
      label: "Taxa de sucesso",
      value: totals.run_count === 0 ? "—" : `${(totals.success_rate * 100).toFixed(1)}%`,
      sub: `${totals.fallback_count} handoff${totals.fallback_count === 1 ? "" : "s"}`,
      icon: CheckCircle2,
      color: "text-emerald-600",
    },
    {
      label: "Custo acumulado",
      value: `US$ ${(totals.cost_usd_cents / 100).toFixed(2)}`,
      sub: `${(totals.tokens_input + totals.tokens_output).toLocaleString("pt-BR")} tokens`,
      icon: TriangleAlert,
      color: "text-amber-600",
    },
    {
      label: "Tempo médio",
      value: totals.run_count === 0 ? "—" : `${(totals.avg_duration_ms / 1000).toFixed(1)}s`,
      sub: "por execução",
      icon: Clock,
      color: "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label}>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{card.label}</span>
                <Icon className={`size-4 ${card.color}`} />
              </div>
              <p className="text-xl font-semibold tabular-nums">{card.value}</p>
              <p className="text-[11px] text-muted-foreground truncate">{card.sub}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
