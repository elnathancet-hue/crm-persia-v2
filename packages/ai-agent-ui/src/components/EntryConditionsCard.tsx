"use client";

import * as React from "react";
import { AlertTriangle, Plus, Trash2, Workflow } from "lucide-react";
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
import {
  EMPTY_FLOW_CATALOGS,
  type FlowCatalogs,
} from "./flow/catalog-types";

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

// UI polish (mai/2026): segment_match e pipeline_stage_match usam Select
// populado por getFlowCatalogs em vez de Input UUID cru. Elimina o risco
// de typo no UUID → condição nunca casa, falha silenciosa.

function getValueText(
  condition: AgentEntryCondition,
  catalogs: FlowCatalogs,
): string {
  const v = condition.condition_value as unknown as Record<string, unknown>;
  switch (condition.condition_type) {
    case "tag_match":
      return String(v.tag_name ?? "");
    case "segment_match": {
      // UI polish: mostra nome do segmento em vez do UUID cru
      const id = String(v.segment_id ?? "");
      const found = catalogs.segments.find((s) => s.id === id);
      return found ? found.name : id || "—";
    }
    case "message_contains":
      return String(v.keyword ?? "");
    case "pipeline_stage_match": {
      // UI polish: mostra nome da etapa em vez do UUID cru
      const id = String(v.stage_id ?? "");
      const found = catalogs.pipeline_stages.find((s) => s.id === id);
      return found ? found.name : id || "—";
    }
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
    getFlowCatalogs,
  } = useAgentActions();
  const [conditions, setConditions] = React.useState<AgentEntryCondition[]>([]);
  const [catalogs, setCatalogs] =
    React.useState<FlowCatalogs>(EMPTY_FLOW_CATALOGS);
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
    Promise.all([listEntryConditions(configId), getFlowCatalogs(configId)])
      .then(([list, cat]) => {
        if (!cancelled) {
          setConditions(list);
          setCatalogs(cat);
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
  }, [configId, isPrimary, listEntryConditions, getFlowCatalogs]);

  // UI polish (mai/2026 — achado #6): warning quando agente secundário
  // não tem regras cadastradas. Sem regras, ele NUNCA recebe leads —
  // fica órfão. pickSecondaryAgent() em entry-conditions.ts:178 só
  // considera agentes que tem pelo menos 1 condition matching.
  const isOrphanWarning =
    !isPrimary && !loading && conditions.length === 0 && !adding;

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
          ) : isOrphanWarning ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning-ring bg-warning-soft p-3">
              <AlertTriangle className="size-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-warning-soft-foreground">
                  Agente órfão — não recebe leads
                </p>
                <p className="mt-0.5 text-xs text-warning-soft-foreground/80">
                  Sem regras cadastradas, este agente nunca é acionado. Adicione
                  pelo menos uma regra abaixo pra ele começar a receber leads.
                </p>
              </div>
            </div>
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
                    {getValueText(condition, catalogs)}
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
                  onValueChange={(value) => {
                    if (value) {
                      setNewType(value as EntryConditionType);
                      // UI polish: reseta value ao trocar tipo (UUID de
                      // segmento não faz sentido como nome de tag, etc).
                      setNewValue("");
                    }
                  }}
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
                {newType === "segment_match" ? (
                  // UI polish: Select de segmentos em vez de Input UUID cru.
                  // Antes: cliente leigo digitava UUID errado → condition
                  // nunca casava, falha silenciosa.
                  <Select
                    value={newValue}
                    onValueChange={(value) => value && setNewValue(value)}
                  >
                    <SelectTrigger id="new-condition-value">
                      <SelectValue placeholder="Selecione um segmento">
                        {newValue
                          ? catalogs.segments.find((s) => s.id === newValue)
                              ?.name ?? newValue
                          : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {catalogs.segments.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs italic text-muted-foreground">
                          Nenhum segmento criado. Crie em Configurações →
                          Segmentos.
                        </div>
                      ) : (
                        catalogs.segments.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                ) : newType === "pipeline_stage_match" ? (
                  // UI polish: Select de etapas de funil em vez de Input UUID.
                  <Select
                    value={newValue}
                    onValueChange={(value) => value && setNewValue(value)}
                  >
                    <SelectTrigger id="new-condition-value">
                      <SelectValue placeholder="Selecione uma etapa">
                        {newValue
                          ? catalogs.pipeline_stages.find(
                              (s) => s.id === newValue,
                            )?.name ?? newValue
                          : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {catalogs.pipeline_stages.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs italic text-muted-foreground">
                          Nenhuma etapa de funil cadastrada.
                        </div>
                      ) : (
                        catalogs.pipeline_stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.pipeline_name
                              ? `${s.pipeline_name} → ${s.name}`
                              : s.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  // Input livre pra tag_match, message_contains, lead_status_match
                  <Input
                    id="new-condition-value"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder={CONDITION_PLACEHOLDERS[newType]}
                  />
                )}
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
