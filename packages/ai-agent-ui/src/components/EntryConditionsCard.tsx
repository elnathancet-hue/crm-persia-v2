"use client";

import * as React from "react";
import { Plus, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentEntryCondition,
  EntryConditionType,
  EntryConditionValue,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { useAgentActions } from "../context";

const CONDITION_LABELS: Record<EntryConditionType, string> = {
  tag_match: "Lead tem a tag",
  segment_match: "Lead esta no segmento",
  message_contains: "Mensagem contem a palavra",
  pipeline_stage_match: "Lead esta na etapa do funil",
  lead_status_match: "Lead tem o status",
};

const CONDITION_PLACEHOLDERS: Record<EntryConditionType, string> = {
  tag_match: "ex: VIP, qualificado",
  segment_match: "ID do segmento (UUID)",
  message_contains: "ex: cotacao, suporte, cancelar",
  pipeline_stage_match: "ID da etapa (UUID)",
  lead_status_match: "ex: new, qualified, lost",
};

function getValueText(condition: AgentEntryCondition): string {
  const v = condition.condition_value as unknown as Record<string, unknown>;
  switch (condition.condition_type) {
    case "tag_match":
      return String(v.tag_name ?? "");
    case "segment_match":
      return String(v.segment_id ?? "");
    case "message_contains":
      return String(v.keyword ?? "");
    case "pipeline_stage_match":
      return String(v.stage_id ?? "");
    case "lead_status_match":
      return String(v.status ?? "");
  }
}

function buildConditionValue(
  type: EntryConditionType,
  text: string,
): EntryConditionValue {
  const trimmed = text.trim();
  switch (type) {
    case "tag_match":
      return { tag_name: trimmed };
    case "segment_match":
      return { segment_id: trimmed };
    case "message_contains":
      return { keyword: trimmed };
    case "pipeline_stage_match":
      return { stage_id: trimmed };
    case "lead_status_match":
      return { status: trimmed };
  }
}

interface Props {
  configId: string;
  isPrimary?: boolean;
}

export function EntryConditionsCard({ configId, isPrimary = false }: Props) {
  const {
    listEntryConditions,
    createEntryCondition,
    deleteEntryCondition,
  } = useAgentActions();
  const [conditions, setConditions] = React.useState<AgentEntryCondition[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const [newType, setNewType] = React.useState<EntryConditionType>("tag_match");
  const [newValue, setNewValue] = React.useState("");

  React.useEffect(() => {
    if (isPrimary) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    listEntryConditions(configId)
      .then((list) => {
        if (!cancelled) {
          setConditions(list);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : "Falha ao carregar regras",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [configId, isPrimary, listEntryConditions]);

  async function handleAdd() {
    if (!newValue.trim()) {
      toast.error("Informe o valor da regra");
      return;
    }
    setPending(true);
    try {
      const created = await createEntryCondition({
        agent_config_id: configId,
        condition_type: newType,
        condition_value: buildConditionValue(newType, newValue),
        priority:
          conditions.length > 0
            ? Math.max(...conditions.map((c) => c.priority)) + 1
            : 0,
      });
      setConditions((prev) => [created, ...prev]);
      setNewValue("");
      setAdding(false);
      toast.success("Regra adicionada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao adicionar");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(id: string) {
    setPending(true);
    try {
      await deleteEntryCondition(id);
      setConditions((prev) => prev.filter((c) => c.id !== id));
      toast.success("Regra removida");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Workflow className="size-4 text-primary" />
          Entrada do agente
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {isPrimary
            ? "Este agente e o fallback principal: responde quando nenhum agente especifico casar com o lead."
            : "Este agente responde quando alguma regra abaixo casar com o lead que esta chegando."}
        </p>
        {!isPrimary ? (
          <strong className="mt-1 block text-xs text-muted-foreground">
            Basta uma regra acionar. Se nenhuma bater, o agente principal
            responde normalmente.
          </strong>
        ) : null}
      </div>

      {isPrimary ? null : (
        <div className="space-y-3">
          {loading ? (
            <p className="text-xs italic text-muted-foreground">
              Carregando...
            </p>
          ) : conditions.length === 0 && !adding ? (
            <p className="text-xs italic text-muted-foreground">
              Nenhuma regra. Sem regras, este agente nunca recebe leads.
            </p>
          ) : (
            conditions.map((condition) => (
              <div
                key={condition.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/70 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {CONDITION_LABELS[condition.condition_type]}
                  </p>
                  <p className="truncate text-sm font-medium">
                    {getValueText(condition)}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  onClick={() => handleDelete(condition.id)}
                  disabled={pending}
                  aria-label="Remover regra"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
          )}

          {adding ? (
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-condition-type" className="text-xs">
                  Tipo
                </Label>
                <Select
                  value={newType}
                  onValueChange={(value) =>
                    value && setNewType(value as EntryConditionType)
                  }
                >
                  <SelectTrigger id="new-condition-type">
                    <SelectValue>{CONDITION_LABELS[newType]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CONDITION_LABELS) as EntryConditionType[])
                      .map((type) => (
                        <SelectItem key={type} value={type}>
                          {CONDITION_LABELS[type]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-condition-value" className="text-xs">
                  Valor
                </Label>
                <Input
                  id="new-condition-value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder={CONDITION_PLACEHOLDERS[newType]}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={pending || !newValue.trim()}
                >
                  Adicionar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setNewValue("");
                  }}
                  disabled={pending}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdding(true)}
              disabled={pending}
            >
              <Plus className="size-4" />
              Adicionar regra
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
