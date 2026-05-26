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
  segment_match: "Selecione um segmento",
  message_contains: "ex: cotacao, suporte, cancelar",
  pipeline_stage_match: "Selecione um funil e uma etapa",
  lead_status_match: "ex: new, qualified, lost",
};

function getValueText(
  condition: AgentEntryCondition,
  catalogs: FlowCatalogs,
): string {
  const v = condition.condition_value as unknown as Record<string, unknown>;
  switch (condition.condition_type) {
    case "tag_match":
      return String(v.tag_name ?? "");
    case "segment_match": {
      const id = String(v.segment_id ?? "");
      const found = catalogs.segments.find((s) => s.id === id);
      return found ? found.name : id || "-";
    }
    case "message_contains":
      return String(v.keyword ?? "");
    case "pipeline_stage_match": {
      const id = String(v.stage_id ?? "");
      const found = catalogs.pipeline_stages.find((s) => s.id === id);
      if (!found) return id || "-";
      return found.pipeline_name ? `${found.pipeline_name} > ${found.name}` : found.name;
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
  const [newPipelineId, setNewPipelineId] = React.useState<string | null>(null);

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

  const isOrphanWarning = !loading && conditions.length === 0 && !adding;

  const pipelineOptions = React.useMemo(() => {
    const byId = new Map<string, string>();
    for (const stage of catalogs.pipeline_stages) {
      if (!byId.has(stage.pipeline_id)) {
        byId.set(
          stage.pipeline_id,
          stage.pipeline_name || `Funil ${stage.pipeline_id.slice(0, 8)}`,
        );
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name }));
  }, [catalogs.pipeline_stages]);

  const stagesForPipeline = React.useMemo(
    () =>
      newPipelineId
        ? catalogs.pipeline_stages.filter((stage) => stage.pipeline_id === newPipelineId)
        : [],
    [catalogs.pipeline_stages, newPipelineId],
  );

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
      setNewPipelineId(null);
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

  function resetDraft() {
    setAdding(false);
    setNewValue("");
    setNewPipelineId(null);
  }

  if (isPrimary) return null;

  return (
    <section className="space-y-4 rounded-lg border border-border/70 bg-background p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Workflow className="size-4 text-primary" />
          Entrada do agente
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Defina quando este agente secundario deve assumir uma conversa nova.
          Se nenhuma regra bater, o agente principal responde.
        </p>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-xs italic text-muted-foreground">Carregando...</p>
        ) : isOrphanWarning ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-ring bg-warning-soft p-3">
            <AlertTriangle className="size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-warning-soft-foreground">
                Agente sem entrada configurada
              </p>
              <p className="mt-0.5 text-xs text-warning-soft-foreground/80">
                Sem uma regra, este agente nao recebe leads novos. Adicione uma
                entrada para ele participar do roteamento.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {conditions.map((condition) => (
              <div
                key={condition.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2"
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
            ))}
          </div>
        )}

        {adding ? (
          <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <Label htmlFor="new-condition-type" className="text-xs">
                  Quando
                </Label>
                <Select
                  value={newType}
                  onValueChange={(value) => {
                    if (!value) return;
                    setNewType(value as EntryConditionType);
                    setNewValue("");
                    setNewPipelineId(null);
                  }}
                >
                  <SelectTrigger id="new-condition-type">
                    <SelectValue>{CONDITION_LABELS[newType]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CONDITION_LABELS) as EntryConditionType[]).map(
                      (type) => (
                        <SelectItem key={type} value={type}>
                          {CONDITION_LABELS[type]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-condition-value" className="text-xs">
                  Entrada
                </Label>
                {newType === "segment_match" ? (
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
                          Nenhum segmento criado.
                        </div>
                      ) : (
                        catalogs.segments.map((segment) => (
                          <SelectItem key={segment.id} value={segment.id}>
                            {segment.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                ) : newType === "pipeline_stage_match" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={newPipelineId ?? "_none"}
                      onValueChange={(value) => {
                        setNewPipelineId(value === "_none" ? null : value);
                        setNewValue("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {newPipelineId
                            ? pipelineOptions.find((p) => p.id === newPipelineId)
                                ?.name ?? "Funil selecionado"
                            : "Escolha o funil"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Escolha o funil</SelectItem>
                        {pipelineOptions.map((pipeline) => (
                          <SelectItem key={pipeline.id} value={pipeline.id}>
                            {pipeline.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={newValue}
                      onValueChange={(value) => value && setNewValue(value)}
                      disabled={!newPipelineId}
                    >
                      <SelectTrigger id="new-condition-value">
                        <SelectValue>
                          {newValue
                            ? catalogs.pipeline_stages.find(
                                (stage) => stage.id === newValue,
                              )?.name ?? "Etapa selecionada"
                            : newPipelineId
                              ? "Escolha a etapa"
                              : "Depois a etapa"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {stagesForPipeline.map((stage) => (
                          <SelectItem key={stage.id} value={stage.id}>
                            {stage.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <Input
                    id="new-condition-value"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder={CONDITION_PLACEHOLDERS[newType]}
                  />
                )}
              </div>
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
                onClick={resetDraft}
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
            Adicionar entrada
          </Button>
        )}
      </div>
    </section>
  );
}
