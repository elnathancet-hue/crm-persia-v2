"use client";

import * as React from "react";
import { Loader2, Plus, Save, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentStage,
  StageActionConfig,
  StageAutoAction,
  StageAutoActionType,
} from "@persia/shared/ai-agent";
import {
  normalizeStageActionConfig,
  STAGE_AUTO_ACTION_TYPES,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { useAgentActions } from "../context";
import type { StageActionCatalogs } from "../types";
import { ACTION_META, StageActionCard } from "./StageActionCard";

// PR-AI-AGENT-STAGE-ACTIONS-UI (mai/2026): editor de "Acoes por etapa".
// Lista visual + pickers contextuais + reorder + persist. Usa as actions
// opcionais `getStageActionCatalogs` + `updateStageActionConfig` do
// AgentActions — se o app nao injetar, este componente nao deveria ser
// renderizado (StageSheet checa).
//
// State management:
//   - Carrega catalogs 1x via getStageActionCatalogs(configId)
//   - Estado local = StageAutoAction[] derivado de stage.action_config
//   - Cada mudanca (add/remove/move/edit) e local; Save persiste via
//     updateStageActionConfig

const MAX_ACTIONS_PER_STAGE = 10;

interface Props {
  stage: AgentStage;
  configId: string;
}

export function StageActionsEditor({ stage, configId }: Props) {
  const actions = useAgentActions();
  const getCatalogs = actions.getStageActionCatalogs;
  const updateConfig = actions.updateStageActionConfig;

  // Guard: se o app nao injetou (admin nao implementa), nao renderiza.
  if (!getCatalogs || !updateConfig) {
    return null;
  }

  const initial = React.useMemo(
    () => normalizeStageActionConfig(stage.action_config).auto_actions,
    [stage.action_config],
  );

  const [items, setItems] = React.useState<StageAutoAction[]>(initial);
  const [catalogs, setCatalogs] = React.useState<StageActionCatalogs | null>(null);
  const [loadingCatalogs, setLoadingCatalogs] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoadingCatalogs(true);
    getCatalogs(configId)
      .then((data) => {
        if (cancelled) return;
        setCatalogs(data);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(
          err instanceof Error ? err.message : "Falha ao carregar opções",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalogs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [configId, getCatalogs]);

  // Reset quando stage muda (Sheet abre pra outra etapa)
  React.useEffect(() => {
    setItems(initial);
  }, [initial]);

  const dirty = React.useMemo(() => {
    if (items.length !== initial.length) return true;
    return JSON.stringify(items) !== JSON.stringify(initial);
  }, [items, initial]);

  function handleAdd(type: StageAutoActionType) {
    if (items.length >= MAX_ACTIONS_PER_STAGE) {
      toast.error(`Máximo de ${MAX_ACTIONS_PER_STAGE} ações por etapa.`);
      return;
    }
    const newAction = makeBlankAction(type);
    setItems((prev) => [...prev, newAction]);
  }

  function handleUpdate(index: number, next: StageAutoAction) {
    setItems((prev) => prev.map((a, i) => (i === index ? next : a)));
  }

  function handleRemove(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      return next;
    });
  }

  function handleMoveDown(index: number) {
    setItems((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
      return next;
    });
  }

  async function handleSave() {
    const config: StageActionConfig = { auto_actions: items };
    setSaving(true);
    try {
      const result = await updateConfig!(stage.id, config);
      // Server pode ter descartado itens invalidos — sincroniza
      setItems(result.sanitized.auto_actions);
      toast.success("Ações salvas");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loadingCatalogs) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-3">
        <Loader2 className="size-3.5 animate-spin" />
        Carregando opções...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Zap className="size-3.5 text-primary" />
            Ações automáticas
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Disparam toda vez que o lead entra nesta etapa. Sem precisar do agente decidir.
          </p>
        </div>
        <AddActionMenu
          onSelect={handleAdd}
          disabled={items.length >= MAX_ACTIONS_PER_STAGE}
        />
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
          <Sparkles className="size-5 mx-auto mb-2 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Nenhuma ação automática. Adicione uma e ela vai disparar quando o lead chegar nesta etapa.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((action, idx) => (
            <StageActionCard
              key={idx}
              action={action}
              catalogs={catalogs!}
              index={idx}
              total={items.length}
              onChange={(next) => handleUpdate(idx, next)}
              onRemove={() => handleRemove(idx)}
              onMoveUp={() => handleMoveUp(idx)}
              onMoveDown={() => handleMoveDown(idx)}
            />
          ))}
        </div>
      )}

      {dirty ? (
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground mr-auto">
            Mudanças não salvas
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setItems(initial)}
            disabled={saving}
          >
            Descartar
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Salvar ações
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function makeBlankAction(type: StageAutoActionType): StageAutoAction {
  switch (type) {
    case "add_tag":
      return { type, tag_name: "" };
    case "move_pipeline_stage":
      return { type, stage_name: "" };
    case "send_media":
      return { type, slug: "" };
    case "trigger_notification":
      return { type, template_name: "" };
    case "transfer_to_user":
      return { type, user: "" };
    case "transfer_to_agent":
      return { type, target_agent_name: "" };
    case "stop_agent":
      return { type };
  }
}

function AddActionMenu({
  onSelect,
  disabled,
}: {
  onSelect: (type: StageAutoActionType) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" size="sm" disabled={disabled}>
            <Plus className="size-3.5" />
            Adicionar ação
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        {STAGE_AUTO_ACTION_TYPES.map((type) => {
          const meta = ACTION_META[type];
          const Icon = meta.icon;
          return (
            <DropdownMenuItem key={type} onClick={() => onSelect(type)}>
              <div className={`size-7 rounded-md flex items-center justify-center shrink-0 ${meta.bg}`}>
                <Icon className="size-3.5" />
              </div>
              <div className="flex flex-col items-start">
                <span className="text-sm">{meta.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {meta.description}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
