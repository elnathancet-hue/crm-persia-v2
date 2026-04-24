"use client";

import * as React from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Coins,
  Loader2,
  RefreshCcw,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AgentRunStatus,
  AgentRunWithSteps,
  AgentStep,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Badge } from "@persia/ui/badge";
import { cn } from "@/lib/utils";
import { listRuns } from "@/actions/ai-agent/audit";

interface Props {
  configId: string;
}

export function AuditTab({ configId }: Props) {
  const [runs, setRuns] = React.useState<AgentRunWithSteps[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const load = React.useCallback(() => {
    setLoading(true);
    listRuns({ config_id: configId, limit: 50 })
      .then((data) => setRuns(data))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Falha ao carregar execuções"))
      .finally(() => setLoading(false));
  }, [configId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const toggle = (runId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Últimas execuções do agente — mostra as chamadas reais ao LLM, ferramentas usadas e duração. Limitado a 50 mais recentes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
          Atualizar
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Carregando execuções...
          </CardContent>
        </Card>
      ) : runs.length === 0 ? (
        <EmptyAudit />
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={expanded.has(run.id)}
              onToggle={() => toggle(run.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyAudit() {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 flex flex-col items-center text-center gap-3">
        <div className="size-12 rounded-xl bg-muted flex items-center justify-center">
          <CircleDashed className="size-6 text-muted-foreground" />
        </div>
        <div className="space-y-1 max-w-md">
          <h3 className="font-semibold">Nenhuma execução registrada</h3>
          <p className="text-sm text-muted-foreground">
            Assim que o agente responder uma conversa ou você usar o testador, as execuções aparecem aqui.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: AgentRunWithSteps;
  expanded: boolean;
  onToggle: () => void;
}) {
  const when = new Date(run.created_at);
  const formattedDate = when.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <Card className={cn(expanded && "border-primary/40")}>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onToggle}
          className="w-full text-left p-4 flex items-center gap-3 hover:bg-muted/30 transition-colors"
          aria-expanded={expanded}
        >
          <div className="shrink-0">
            {expanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </div>
          <RunStatusBadge status={run.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground">
                {formattedDate}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{run.steps.length} passo{run.steps.length === 1 ? "" : "s"}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs font-mono text-muted-foreground">{run.model}</span>
            </div>
            {run.error_msg ? (
              <p className="text-xs text-destructive mt-0.5 line-clamp-1">
                {run.error_msg}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
            <span className="flex items-center gap-1">
              <Coins className="size-3" />
              {run.tokens_input + run.tokens_output}
            </span>
            <span className="tabular-nums">{run.duration_ms}ms</span>
          </div>
        </button>
        {expanded ? (
          <div className="border-t px-4 py-3 space-y-2 bg-muted/10">
            {run.steps.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Sem passos registrados.</p>
            ) : (
              run.steps.map((step) => <StepRow key={step.id} step={step} />)
            )}
            <div className="text-[11px] text-muted-foreground pt-2 border-t mt-2 flex items-center justify-between">
              <span>Custo: {formatCost(run.cost_usd_cents)}</span>
              <span className="font-mono">run_id: {run.id.slice(0, 8)}…</span>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  const iconColor =
    step.step_type === "guardrail"
      ? "text-amber-600"
      : step.step_type === "tool"
      ? "text-primary"
      : "text-muted-foreground";

  const label =
    step.step_type === "llm"
      ? "LLM"
      : step.step_type === "tool"
      ? step.native_handler ?? "tool"
      : "guardrail";

  const iconClass = cn("size-3.5 shrink-0 mt-0.5", iconColor);
  const stepIcon =
    step.step_type === "llm" ? (
      <CircleDot className={iconClass} />
    ) : step.step_type === "tool" ? (
      <Wrench className={iconClass} />
    ) : (
      <TriangleAlert className={iconClass} />
    );

  return (
    <div className="flex items-start gap-2 text-xs">
      {stepIcon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground tabular-nums">{step.duration_ms}ms</span>
        </div>
        {step.step_type === "tool" && step.output ? (
          <pre className="mt-1 font-mono text-[10px] bg-card border rounded px-2 py-1 overflow-x-auto">
            {truncate(JSON.stringify(step.output), 200)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: AgentRunStatus }) {
  const STATUS_STYLES: Record<AgentRunStatus, { label: string; className: string }> = {
    succeeded: {
      label: "Sucesso",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    },
    failed: {
      label: "Falhou",
      className: "bg-destructive/15 text-destructive border-destructive/30",
    },
    fallback: {
      label: "Handoff",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    },
    running: {
      label: "Rodando",
      className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
    },
    pending: {
      label: "Pendente",
      className: "bg-muted text-muted-foreground border-border",
    },
    canceled: {
      label: "Cancelado",
      className: "bg-muted text-muted-foreground border-border",
    },
  };
  const { label, className } = STATUS_STYLES[status];
  const iconClass = cn("size-3", status === "running" && "animate-spin");
  const statusIcon =
    status === "succeeded" ? <CircleCheck className={iconClass} /> :
    status === "failed" ? <AlertCircle className={iconClass} /> :
    status === "fallback" ? <TriangleAlert className={iconClass} /> :
    status === "running" ? <Loader2 className={iconClass} /> :
    <CircleDashed className={iconClass} />;
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium shrink-0", className)}>
      {statusIcon}
      {label}
    </Badge>
  );
}

function formatCost(cents: number): string {
  if (cents === 0) return "< US$ 0,01";
  return `US$ ${(cents / 100).toFixed(3)}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
