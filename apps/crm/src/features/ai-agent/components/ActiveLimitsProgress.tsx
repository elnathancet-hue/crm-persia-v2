import type { ActiveCostLimits, CostLimitSnapshot } from "@persia/shared/ai-agent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  limits: ActiveCostLimits;
}

export function ActiveLimitsProgress({ limits }: Props) {
  const rows: Array<{ label: string; snapshot: CostLimitSnapshot | null }> = [
    { label: "Agente (hoje)", snapshot: limits.agent_daily },
    { label: "Organização (hoje)", snapshot: limits.org_daily },
    { label: "Organização (mes)", snapshot: limits.org_monthly },
  ];

  const hasAny = rows.some((r) => r.snapshot !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Consumo vs limites</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasAny ? (
          rows.map((row) => <LimitRow key={row.label} label={row.label} snapshot={row.snapshot} />)
        ) : (
          <p className="text-xs text-muted-foreground italic py-4 text-center">
            Nenhum limite configurado. Sem limites, o agente pode gastar o teto da conta Anthropic. Considere definir pelo menos um limite mensal.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LimitRow({
  label,
  snapshot,
}: {
  label: string;
  snapshot: CostLimitSnapshot | null;
}) {
  if (!snapshot) {
    return (
      <div className="text-xs flex items-center justify-between gap-2 py-1.5 border-b last:border-0">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground/60 italic">Não configurado</span>
      </div>
    );
  }

  const hasTokens = snapshot.max_tokens != null;
  const hasUsd = snapshot.max_usd_cents != null;
  const util = snapshot.utilization ?? 0;
  const pct = Math.min(100, Math.round(util * 100));
  const over = util >= 1;
  const warn = util >= 0.8;

  const usdUsed = (snapshot.used_usd_cents / 100).toFixed(2);
  const usdMax = snapshot.max_usd_cents != null ? (snapshot.max_usd_cents / 100).toFixed(2) : null;

  return (
    <div className="space-y-1.5 pb-2 border-b last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <div className="flex items-center gap-3 text-muted-foreground tabular-nums">
          {hasTokens ? (
            <span>
              {snapshot.used_tokens.toLocaleString("pt-BR")} / {snapshot.max_tokens?.toLocaleString("pt-BR")} tokens
            </span>
          ) : null}
          {hasUsd ? (
            <span>
              US$ {usdUsed} / US$ {usdMax}
            </span>
          ) : null}
        </div>
      </div>
      {util != null ? (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full transition-all",
              over ? "bg-destructive" : warn ? "bg-amber-500" : "bg-emerald-500",
            )}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
      ) : null}
      {over ? (
        <p className="text-[10px] text-destructive">Limite excedido — novas execuções caem em handoff.</p>
      ) : warn ? (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">Acima de 80% do limite.</p>
      ) : null}
    </div>
  );
}
