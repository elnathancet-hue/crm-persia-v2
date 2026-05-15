"use client";

import * as React from "react";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentCostLimit,
  CostLimitScope,
  SetCostLimitInput,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { useAgentActions } from "../context";

interface Props {
  configId: string;
  initialLimits: AgentCostLimit[];
  onChange: (next: AgentCostLimit[]) => void;
}

interface Row {
  scope: CostLimitScope;
  subject_id: string | null;
  label: string;
  help: string;
}

export function LimitsEditor({ configId, initialLimits, onChange }: Props) {
  const rows: Row[] = React.useMemo(
    () => [
      {
        scope: "agent_daily",
        subject_id: configId,
        label: "Por agente · dia",
        help: "Soma das execuções deste agente em janela rolante de 24h.",
      },
      {
        scope: "org_daily",
        subject_id: null,
        label: "Por organização · dia",
        help: "Soma de todas as execuções da organização em janela rolante de 24h.",
      },
      {
        scope: "org_monthly",
        subject_id: null,
        label: "Por organização · mes",
        help: "Mes corrente em UTC.",
      },
    ],
    [configId],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Limites de custo</CardTitle>
        <p className="text-xs text-muted-foreground">
          Quando qualquer limite é atingido, novas execuções caem para handoff humano em vez de consumir mais tokens.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row) => (
          <LimitRowEditor
            key={`${row.scope}:${row.subject_id ?? "org"}`}
            row={row}
            current={findLimit(initialLimits, row.scope, row.subject_id)}
            onSaved={(saved) => onChange(upsertLimit(initialLimits, saved))}
            onCleared={(id) => onChange(initialLimits.filter((l) => l.id !== id))}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function LimitRowEditor({
  row,
  current,
  onSaved,
  onCleared,
}: {
  row: Row;
  current: AgentCostLimit | undefined;
  onSaved: (saved: AgentCostLimit) => void;
  onCleared: (id: string) => void;
}) {
  const { setCostLimit, deleteCostLimit } = useAgentActions();
  const [tokens, setTokens] = React.useState<string>(
    current?.max_tokens?.toString() ?? "",
  );
  const [usd, setUsd] = React.useState<string>(
    current?.max_usd_cents != null ? (current.max_usd_cents / 100).toFixed(2) : "",
  );
  const [isPending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setTokens(current?.max_tokens?.toString() ?? "");
    setUsd(current?.max_usd_cents != null ? (current.max_usd_cents / 100).toFixed(2) : "");
  }, [current?.id, current?.max_tokens, current?.max_usd_cents]);

  const parsedTokens = tokens.trim() === "" ? null : Number(tokens);
  const parsedUsdDollars = usd.trim() === "" ? null : Number(usd);
  const parsedUsdCents =
    parsedUsdDollars === null ? null : Math.round(parsedUsdDollars * 100);

  const invalidTokens = parsedTokens !== null && (!Number.isFinite(parsedTokens) || parsedTokens < 0);
  const invalidUsd = parsedUsdDollars !== null && (!Number.isFinite(parsedUsdDollars) || parsedUsdDollars < 0);
  const dirty =
    parsedTokens !== (current?.max_tokens ?? null) ||
    parsedUsdCents !== (current?.max_usd_cents ?? null);

  const handleSave = () => {
    if (invalidTokens || invalidUsd) {
      toast.error("Valores inválidos");
      return;
    }
    const input: SetCostLimitInput = {
      scope: row.scope,
      subject_id: row.subject_id ?? undefined,
      max_tokens: parsedTokens,
      max_usd_cents: parsedUsdCents,
    };
    startTransition(async () => {
      try {
        const saved = await setCostLimit(input);
        onSaved(saved);
        toast.success("Limite salvo");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao salvar limite");
      }
    });
  };

  const handleClear = () => {
    if (!current) {
      setTokens("");
      setUsd("");
      return;
    }
    startTransition(async () => {
      try {
        await deleteCostLimit(current.id);
        onCleared(current.id);
        toast.success("Limite removido");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao remover limite");
      }
    });
  };

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{row.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{row.help}</p>
        </div>
        {current ? (
          <span className="text-[10px] px-2 py-0.5 rounded bg-success-soft text-success-soft-foreground uppercase tracking-wider">
            Ativo
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div className="space-y-1">
          <Label htmlFor={`${row.scope}-tokens`} className="text-xs">
            Teto de tokens
          </Label>
          <Input
            id={`${row.scope}-tokens`}
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            placeholder="Sem limite"
            value={tokens}
            onChange={(e) => setTokens(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${row.scope}-usd`} className="text-xs">
            Teto em USD
          </Label>
          <Input
            id={`${row.scope}-usd`}
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            placeholder="Sem limite"
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        {current ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={isPending}
          >
            <Trash2 className="size-3.5" />
            Remover
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending || !dirty || invalidTokens || invalidUsd}
        >
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

function findLimit(
  limits: AgentCostLimit[],
  scope: CostLimitScope,
  subjectId: string | null,
): AgentCostLimit | undefined {
  return limits.find(
    (l) => l.scope === scope && (l.subject_id ?? null) === subjectId,
  );
}

function upsertLimit(limits: AgentCostLimit[], saved: AgentCostLimit): AgentCostLimit[] {
  const idx = limits.findIndex((l) => l.id === saved.id);
  if (idx >= 0) return limits.map((l, i) => (i === idx ? saved : l));
  return [...limits, saved];
}
