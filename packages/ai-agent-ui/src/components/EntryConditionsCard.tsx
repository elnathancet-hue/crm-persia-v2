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
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
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

// PR-AGENT-INTEGRATION-3 (mai/2026): card que aparece em Regras pra
// agentes nao-principais. Cliente define quando esse agente deve
// "tomar" o lead em vez do principal. OR logic — basta UMA condicao
// bater.

const CONDITION_LABELS: Record<EntryConditionType, string> = {
  tag_match: "Lead tem a tag",
  segment_match: "Lead está no segmento",
  message_contains: "Mensagem contém a palavra",
  pipeline_stage_match: "Lead está na etapa do funil",
  lead_status_match: "Lead tem o status",
};

const CONDITION_PLACEHOLDERS: Record<EntryConditionType, string> = {
  tag_match: "ex: VIP, qualificado",
  segment_match: "ID do segmento (UUID)",
  message_contains: "ex: cotação, suporte, cancelar",
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
}

export function EntryConditionsCard({ configId }: Props) {
  const {
    listEntryConditions,
    createEntryCondition,
    deleteEntryCondition,
  } = useAgentActions();
  const [conditions, setConditions] = React.useState<AgentEntryCondition[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  // Form de nova condicao
  const [newType, setNewType] = React.useState<EntryConditionType>("tag_match");
  const [newValue, setNewValue] = React.useState("");

  React.useEffect(() => {
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
  }, [configId, listEntryConditions]);

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
        priority: conditions.length > 0
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Workflow className="size-4 text-primary" />
          Quando este agente é ativado
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Como esse não é o agente principal, ele só responde quando alguma
          das regras abaixo bate com o lead que está chegando.
          <strong className="block mt-1">Basta uma regra acionar</strong> —
          se nenhuma bater, o agente principal responde normalmente.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground italic">Carregando...</p>
        ) : conditions.length === 0 && !adding ? (
          <p className="text-xs text-muted-foreground italic">
            Nenhuma regra. Sem regras, este agente nunca recebe leads.
          </p>
        ) : (
          conditions.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">
                  {CONDITION_LABELS[c.condition_type]}
                </p>
                <p className="text-sm font-medium truncate">{getValueText(c)}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                onClick={() => handleDelete(c.id)}
                disabled={pending}
                aria-label="Remover regra"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))
        )}

        {adding ? (
          <div className="space-y-2 pt-2 border-t">
            <div className="space-y-1.5">
              <Label htmlFor="new-condition-type" className="text-xs">
                Tipo
              </Label>
              <Select
                value={newType}
                onValueChange={(v) =>
                  v && setNewType(v as EntryConditionType)
                }
              >
                <SelectTrigger id="new-condition-type">
                  <SelectValue>{CONDITION_LABELS[newType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONDITION_LABELS) as EntryConditionType[]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {CONDITION_LABELS[t]}
                      </SelectItem>
                    ),
                  )}
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
      </CardContent>
    </Card>
  );
}
