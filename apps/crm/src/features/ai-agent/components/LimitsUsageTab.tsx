"use client";

import * as React from "react";
import { Activity, BarChart3, Coins, Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentCostLimit,
  UsageStats,
  UsageStatsInput,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { getUsageStats } from "@/actions/ai-agent/usage";
import { LimitsEditor } from "./LimitsEditor";
import { ActiveLimitsProgress } from "./ActiveLimitsProgress";
import { UsageStatsCards } from "./UsageStatsCards";
import { UsageChart } from "./UsageChart";

type Range = UsageStatsInput["range"];

interface Props {
  configId: string;
  initialLimits: AgentCostLimit[];
}

const RANGE_LABELS: Record<Range, string> = {
  today: "Hoje",
  last_7_days: "7 dias",
  last_30_days: "30 dias",
  month_to_date: "Mes corrente",
};

export function LimitsUsageTab({ configId, initialLimits }: Props) {
  const [limits, setLimits] = React.useState(initialLimits);
  const [range, setRange] = React.useState<Range>("last_30_days");
  const [stats, setStats] = React.useState<UsageStats | null>(null);
  const [loading, setLoading] = React.useState(true);

  const loadStats = React.useCallback(
    (targetRange: Range) => {
      setLoading(true);
      getUsageStats({ config_id: configId, range: targetRange })
        .then(setStats)
        .catch((err) => toast.error(err instanceof Error ? err.message : "Falha ao carregar uso"))
        .finally(() => setLoading(false));
    },
    [configId],
  );

  React.useEffect(() => {
    loadStats(range);
  }, [loadStats, range]);

  // When limits change, reload stats so progress bars reflect the new thresholds.
  const handleLimitsChange = (next: AgentCostLimit[]) => {
    setLimits(next);
    loadStats(range);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Defina tetos de consumo e acompanhe o uso real. Limites ativos fazem o agente cair em handoff humano em vez de continuar gastando tokens.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={range} onValueChange={(v) => v && setRange(v as Range)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RANGE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadStats(range)}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
          </Button>
        </div>
      </div>

      {stats ? (
        <>
          <UsageStatsCards totals={stats.totals} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="size-4 text-primary" />
                  Execuções por dia
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UsageChart points={stats.points} metric="runs" />
                <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                  <Activity className="size-3" />
                  {stats.points.length} dia{stats.points.length === 1 ? "" : "s"} · {RANGE_LABELS[stats.range]}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Coins className="size-4 text-primary" />
                  Custo por dia (USD)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UsageChart points={stats.points} metric="cost" />
                <p className="text-[11px] text-muted-foreground mt-2">
                  Total: US$ {(stats.totals.cost_usd_cents / 100).toFixed(2)}
                </p>
              </CardContent>
            </Card>
          </div>

          <ActiveLimitsProgress limits={stats.limits} />
        </>
      ) : loading ? (
        <Card>
          <CardContent className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Carregando estatísticas...
          </CardContent>
        </Card>
      ) : null}

      <LimitsEditor
        configId={configId}
        initialLimits={limits}
        onChange={handleLimitsChange}
      />
    </div>
  );
}
