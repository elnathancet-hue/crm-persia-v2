"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BellRing,
  Bot,
  Columns3,
  Image as ImageIcon,
  PowerOff,
  Tag as TagIcon,
  Trash2,
  UserCheck,
} from "lucide-react";
import type {
  StageAutoAction,
  StageAutoActionType,
  ToolSuccessTriggerHandler,
} from "@persia/shared/ai-agent";
import { TOOL_SUCCESS_TRIGGER_HANDLERS } from "@persia/shared/ai-agent";
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
import type { StageActionCatalogs } from "../types";

// PR-AI-AGENT-STAGE-ACTIONS-UI: cartao individual de uma auto_action.
// Renderiza picker contextual baseado no tipo + botoes de reordenar +
// remover. Validacao acontece no editor pai (StageActionsEditor).

interface Props {
  action: StageAutoAction;
  catalogs: StageActionCatalogs;
  index: number;
  total: number;
  onChange: (next: StageAutoAction) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const ACTION_META: Record<
  StageAutoActionType,
  { icon: typeof TagIcon; label: string; description: string; bg: string }
> = {
  add_tag: {
    icon: TagIcon,
    label: "Adicionar tag",
    description: "Marca o lead com uma tag existente",
    bg: "bg-success-soft text-success-soft-foreground",
  },
  move_pipeline_stage: {
    icon: Columns3,
    label: "Mover funil",
    description: "Move o card do lead pra outra etapa do Kanban",
    bg: "bg-primary/10 text-primary",
  },
  send_media: {
    icon: ImageIcon,
    label: "Enviar mídia",
    description: "Envia arquivo da Biblioteca pelo WhatsApp",
    bg: "bg-progress-soft text-progress-soft-foreground",
  },
  trigger_notification: {
    icon: BellRing,
    label: "Notificar equipe",
    description: "Dispara template WhatsApp pra equipe",
    bg: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  transfer_to_user: {
    icon: UserCheck,
    label: "Transferir pra membro",
    description: "Atribui o lead a um atendente da equipe",
    bg: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  transfer_to_agent: {
    icon: Bot,
    label: "Transferir pra outro agente IA",
    description: "Passa a conversa pra outro agente (ex: Vendas)",
    bg: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  },
  stop_agent: {
    icon: PowerOff,
    label: "Pausar agente (handoff humano)",
    description: "Para a IA e transfere a conversa pra atendimento humano",
    bg: "bg-destructive/10 text-destructive",
  },
};

export function StageActionCard({
  action,
  catalogs,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: Props) {
  const meta = ACTION_META[action.type];
  const Icon = meta.icon;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className={`size-8 rounded-md flex items-center justify-center shrink-0 ${meta.bg}`}>
          <Icon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={onMoveUp}
            title="Mover pra cima"
            className="size-7"
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === total - 1}
            onClick={onMoveDown}
            title="Mover pra baixo"
            className="size-7"
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            title="Remover ação"
            className="size-7 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <ActionPicker action={action} catalogs={catalogs} onChange={onChange} />
      <TriggerPicker action={action} onChange={onChange} />
    </div>
  );
}

// ============================================================================
// TriggerPicker — quando a acao dispara (PR2, mai/2026)
// ----------------------------------------------------------------------------
// 2 modos:
//   - "on_enter" (default): dispara uma vez ao entrar na etapa, idempotente.
//   - "on_tool_success": dispara toda vez que a tool selecionada retornar
//     sucesso dentro desta etapa. Sem idempotency tracking — multiplo ok.
// ============================================================================

const TRIGGER_LABELS: Record<ToolSuccessTriggerHandler, string> = {
  create_appointment: "Após agendar reunião",
  reschedule_appointment: "Após reagendar reunião",
  cancel_appointment: "Após cancelar reunião",
  transfer_to_user: "Após transferir pra humano",
  transfer_to_agent: "Após transferir pra outro agente",
};

function TriggerPicker({
  action,
  onChange,
}: {
  action: StageAutoAction;
  onChange: (next: StageAutoAction) => void;
}) {
  const isOnToolSuccess = action.trigger === "on_tool_success";
  const currentTool = action.on_tool_success_of ?? "create_appointment";

  function handleModeChange(value: string | null) {
    if (!value || value === "on_enter") {
      const next = { ...action };
      delete (next as Partial<StageAutoAction>).trigger;
      delete (next as Partial<StageAutoAction>).on_tool_success_of;
      onChange(next as StageAutoAction);
    } else {
      onChange({
        ...action,
        trigger: "on_tool_success",
        on_tool_success_of: currentTool,
      });
    }
  }

  function handleToolChange(value: string | null) {
    if (!value || !isToolSuccessTriggerHandler(value)) return;
    onChange({
      ...action,
      trigger: "on_tool_success",
      on_tool_success_of: value,
    });
  }

  return (
    <div className="space-y-1.5 pt-1 border-t border-border/60">
      <Label className="text-xs">Quando disparar?</Label>
      <Select
        value={isOnToolSuccess ? "on_tool_success" : "on_enter"}
        onValueChange={handleModeChange}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="on_enter">
            <div className="flex flex-col items-start">
              <span>Ao entrar na etapa</span>
              <span className="text-[10px] text-muted-foreground">
                Dispara uma vez quando o lead chega aqui
              </span>
            </div>
          </SelectItem>
          <SelectItem value="on_tool_success">
            <div className="flex flex-col items-start">
              <span>Após tool específica</span>
              <span className="text-[10px] text-muted-foreground">
                Só dispara quando a tool retornar sucesso
              </span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
      {isOnToolSuccess ? (
        <div className="space-y-1.5 pt-1.5">
          <Label className="text-xs text-muted-foreground">Tool gatilho</Label>
          <Select value={currentTool} onValueChange={handleToolChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOOL_SUCCESS_TRIGGER_HANDLERS.map((tool) => (
                <SelectItem key={tool} value={tool}>
                  <div className="flex flex-col items-start">
                    <span>{TRIGGER_LABELS[tool]}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {tool}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Útil pra confirmar agendamento real: a tag/notificação só dispara
            depois que a tool agendou de verdade — evita IA "prometer" e equipe
            ser notificada sem evento no banco.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function isToolSuccessTriggerHandler(value: string): value is ToolSuccessTriggerHandler {
  return (TOOL_SUCCESS_TRIGGER_HANDLERS as readonly string[]).includes(value);
}

// ============================================================================
// Picker contextual — switch por tipo
// ============================================================================

function ActionPicker({
  action,
  catalogs,
  onChange,
}: {
  action: StageAutoAction;
  catalogs: StageActionCatalogs;
  onChange: (next: StageAutoAction) => void;
}) {
  switch (action.type) {
    case "add_tag":
      return (
        <PickerOneOf
          label="Tag"
          value={action.tag_name}
          options={catalogs.tags.map((t) => ({
            value: t.name,
            label: t.name,
            hint: t.description ?? undefined,
          }))}
          onChange={(v) => onChange({ ...action, tag_name: v })}
          emptyHint="Sem tags cadastradas. Crie uma em CRM → Tags."
        />
      );

    case "move_pipeline_stage":
      return (
        <KanbanStagePicker
          value={action.stage_name}
          catalogs={catalogs}
          onChange={(v) => onChange({ ...action, stage_name: v })}
        />
      );

    case "send_media":
      return (
        <div className="space-y-2">
          <PickerOneOf
            label="Mídia"
            value={action.slug}
            options={catalogs.media.map((m) => ({
              value: m.slug,
              label: m.name,
              hint: m.category,
            }))}
            onChange={(v) => onChange({ ...action, slug: v })}
            emptyHint="Sem mídia cadastrada. Suba uma em Automação → Biblioteca de mídia."
          />
          <div className="space-y-1.5">
            <Label className="text-xs">Legenda (opcional)</Label>
            <Input
              value={action.caption ?? ""}
              onChange={(e) =>
                onChange({
                  ...action,
                  caption: e.target.value || undefined,
                })
              }
              placeholder="Texto que vai junto com a mídia"
              maxLength={500}
            />
          </div>
        </div>
      );

    case "trigger_notification":
      return (
        <PickerOneOf
          label="Template de notificação"
          value={action.template_name}
          options={catalogs.notificationTemplates.map((t) => ({
            value: t.name,
            label: t.name,
            hint: t.description ?? undefined,
          }))}
          onChange={(v) => onChange({ ...action, template_name: v })}
          emptyHint="Sem templates configurados. Crie em Notificações deste agente."
        />
      );

    case "transfer_to_user":
      return (
        <PickerOneOf
          label="Membro da equipe"
          value={action.user}
          options={catalogs.members.map((m) => ({
            value: m.email ?? m.name,
            label: m.name,
            hint: m.email ?? undefined,
          }))}
          onChange={(v) => onChange({ ...action, user: v })}
          emptyHint="Sem membros ativos na organização."
        />
      );

    case "transfer_to_agent":
      return (
        <PickerOneOf
          label="Outro agente IA"
          value={action.target_agent_name}
          options={catalogs.agents.map((a) => ({
            value: a.name,
            label: a.name,
            hint: a.description ?? undefined,
          }))}
          onChange={(v) => onChange({ ...action, target_agent_name: v })}
          emptyHint="Sem outros agentes ativos. Crie em Agente IA."
        />
      );

    case "stop_agent":
      return (
        <div className="space-y-1.5">
          <Label className="text-xs">Motivo (opcional)</Label>
          <Input
            value={action.reason ?? ""}
            onChange={(e) =>
              onChange({ ...action, reason: e.target.value || undefined })
            }
            placeholder="Ex: cliente pediu humano, fora do escopo"
            maxLength={500}
          />
        </div>
      );
  }
}

// ============================================================================
// PickerOneOf — Select reusavel com hint + estado vazio
// ============================================================================

interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

function PickerOneOf({
  label,
  value,
  options,
  onChange,
  emptyHint,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  emptyHint: string;
}) {
  if (options.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{label}</Label>
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {emptyHint}
        </div>
      </div>
    );
  }
  const isOrphan = value && !options.some((o) => o.value === value);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger
          className={isOrphan ? "border-destructive focus-visible:ring-destructive/40" : undefined}
        >
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <div className="flex flex-col items-start">
                <span>{o.label}</span>
                {o.hint ? (
                  <span className="text-[10px] text-muted-foreground">{o.hint}</span>
                ) : null}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isOrphan ? (
        <p className="text-xs text-destructive">
          O valor configurado ({value}) não existe mais. Escolha outro.
        </p>
      ) : null}
    </div>
  );
}

// ============================================================================
// KanbanStagePicker — agrupa por pipeline
// ============================================================================

function KanbanStagePicker({
  value,
  catalogs,
  onChange,
}: {
  value: string;
  catalogs: StageActionCatalogs;
  onChange: (value: string) => void;
}) {
  // Flatten + tag por pipeline
  const allStages = catalogs.kanbanPipelines.flatMap((p) =>
    p.stages.map((s) => ({
      value: s.name,
      label: s.name,
      hint: `${p.name}${s.outcome === "bem_sucedido" ? " · sucesso" : s.outcome === "falha" ? " · perdido" : ""}`,
    })),
  );

  // Dedup por nome (varios pipelines podem ter "Qualificado" — handler
  // usa o do funil do lead, mas UI mostra um so pra simplificar).
  const seen = new Set<string>();
  const uniqueStages: PickerOption[] = [];
  for (const s of allStages) {
    if (seen.has(s.value)) continue;
    seen.add(s.value);
    uniqueStages.push(s);
  }

  return (
    <PickerOneOf
      label="Etapa do funil"
      value={value}
      options={uniqueStages}
      onChange={onChange}
      emptyHint="Sem etapas no Kanban. Crie um funil em CRM."
    />
  );
}

// Re-export ACTION_META pro editor pai
export { ACTION_META };
// Re-export icon pra menu de "adicionar acao"
export { ArrowRight };
