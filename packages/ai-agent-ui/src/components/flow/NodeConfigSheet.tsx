"use client";

// AI Agent — Sheet de edição de node (PR-FLOW-PIVOT PR 4, mai/2026).
//
// Abre quando o cliente clica num node do canvas. Renderiza form
// específico por tipo:
//   - entry: só `label` (V1 sem options)
//   - ai_agent: label + system_prompt + lista de instructions com
//     output_handle nomeado
//   - action: por action_type — selects das entidades reais (cliente
//     NUNCA digita ID livre)
//   - condition: por condition_type (V1 marca "Em construção", segue
//     editável pra UX consistente)
//
// Save fecha o sheet e devolve `onSave(nodeId, newData)` pro
// FlowCanvas atualizar o state local + marcar dirty.

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FlowNode } from "@persia/shared/ai-agent";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@persia/ui/sheet";
import { Textarea } from "@persia/ui/textarea";
import type { FlowCatalogs } from "./catalog-types";
import { EMPTY_FLOW_CATALOGS } from "./catalog-types";

interface NodeConfigSheetProps {
  node: FlowNode | null;
  open: boolean;
  catalogs: FlowCatalogs;
  catalogsLoading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (nodeId: string, newData: Record<string, unknown>) => void;
  onDelete?: (nodeId: string) => void;
}

export function NodeConfigSheet({
  node,
  open,
  catalogs,
  catalogsLoading,
  onOpenChange,
  onSave,
  onDelete,
}: NodeConfigSheetProps) {
  // Local form state. Inicializa do node.data quando abre + reseta
  // sempre que troca de node.
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});

  React.useEffect(() => {
    if (node) setDraft({ ...(node.data as Record<string, unknown>) });
  }, [node]);

  if (!node) return null;

  const handleSave = () => {
    onSave(node.id, draft);
    onOpenChange(false);
    toast.success("Configuração salva.");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Configurar {sheetTitle(node)}</SheetTitle>
          <SheetDescription>
            Ajuste o comportamento desta tarefa. Mudanças entram em vigor
            ao salvar.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4 px-1 space-y-4">
          {node.type === "entry" ? (
            <EntryForm draft={draft} setDraft={setDraft} />
          ) : null}
          {node.type === "ai_agent" ? (
            <AIAgentForm draft={draft} setDraft={setDraft} />
          ) : null}
          {node.type === "action" ? (
            <ActionForm
              draft={draft}
              setDraft={setDraft}
              catalogs={catalogs}
              catalogsLoading={catalogsLoading}
            />
          ) : null}
          {node.type === "condition" ? (
            <ConditionForm
              draft={draft}
              setDraft={setDraft}
              catalogs={catalogs}
              catalogsLoading={catalogsLoading}
            />
          ) : null}
        </div>

        <SheetFooter className="flex-row justify-between gap-2">
          {onDelete && node.type !== "entry" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm("Remover este node do fluxo?")) {
                  onDelete(node.id);
                  onOpenChange(false);
                }
              }}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5 mr-1" />
              Remover
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>Salvar</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function sheetTitle(node: FlowNode): string {
  switch (node.type) {
    case "entry":
      return "ponto de entrada";
    case "ai_agent":
      return "node de IA";
    case "action":
      return "ação automática";
    case "condition":
      return "verificação";
  }
}

// ============================================================================
// Forms por tipo
// ============================================================================

interface FormProps {
  draft: Record<string, unknown>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}

interface CatalogFormProps extends FormProps {
  catalogs: FlowCatalogs;
  catalogsLoading?: boolean;
}

function EntryForm({ draft, setDraft }: FormProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="entry-label">Nome desta entrada</Label>
        <Input
          id="entry-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder="Conversa iniciada"
        />
        <p className="text-xs text-muted-foreground">
          O fluxo inicia neste node quando o lead manda a primeira mensagem.
        </p>
      </div>
    </div>
  );
}

function AIAgentForm({ draft, setDraft }: FormProps) {
  const instructions = (draft.instructions as Array<{
    id: string;
    description: string;
    output_handle: string;
  }>) ?? [];

  const addInstruction = () => {
    setDraft((d) => ({
      ...d,
      instructions: [
        ...((d.instructions as unknown[]) ?? []),
        {
          id: crypto.randomUUID(),
          description: "",
          output_handle: `evento_${instructions.length + 1}`,
        },
      ],
    }));
  };

  const updateInstruction = (
    idx: number,
    patch: Partial<{ description: string; output_handle: string }>,
  ) => {
    setDraft((d) => {
      const list = [...(((d.instructions as unknown[]) ?? []) as Array<{
        id: string;
        description: string;
        output_handle: string;
      }>)];
      list[idx] = { ...list[idx]!, ...patch };
      return { ...d, instructions: list };
    });
  };

  const removeInstruction = (idx: number) => {
    setDraft((d) => {
      const list = [...(((d.instructions as unknown[]) ?? []) as unknown[])];
      list.splice(idx, 1);
      return { ...d, instructions: list };
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ai-label">Nome do node</Label>
        <Input
          id="ai-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder="Conversar com IA"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-prompt">Instruções pra IA</Label>
        <Textarea
          id="ai-prompt"
          value={(draft.system_prompt as string) ?? ""}
          onChange={(e) =>
            setDraft((d) => ({ ...d, system_prompt: e.target.value }))
          }
          placeholder="Descreva o que a IA deve fazer aqui (ex: 'Pergunte sobre o problema do lead, orçamento, prazo e quem decide. Depois marque como qualificado')."
          rows={8}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          A IA segue essas instruções + o prompt geral do agente.
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Eventos de saída</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addInstruction}
          >
            <Plus className="size-3.5 mr-1" />
            Adicionar evento
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Defina eventos que a IA pode sinalizar (ex: "lead_qualificado",
          "agendou_reuniao"). Cada evento vira uma saída do node — você
          conecta a uma ação no canvas.
        </p>
        {instructions.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
            Sem eventos cadastrados. A IA usa a saída padrão.
          </div>
        ) : (
          <div className="space-y-2">
            {instructions.map((ins, idx) => (
              <div
                key={ins.id}
                className="rounded-md border border-border bg-card p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <Label className="text-[11px]">Evento #{idx + 1}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeInstruction(idx)}
                    className="h-6 w-6 p-0 text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <Input
                  value={ins.output_handle}
                  onChange={(e) =>
                    updateInstruction(idx, { output_handle: e.target.value })
                  }
                  placeholder="nome_do_evento"
                  className="h-7 text-xs font-mono"
                />
                <Textarea
                  value={ins.description}
                  onChange={(e) =>
                    updateInstruction(idx, { description: e.target.value })
                  }
                  placeholder="Quando a IA deve sinalizar este evento? (ex: 'quando coletou os 4 dados de qualificação')"
                  rows={2}
                  className="text-xs"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionForm({
  draft,
  setDraft,
  catalogs,
  catalogsLoading,
}: CatalogFormProps) {
  const actionType = draft.action_type as string;
  const config = (draft.config as Record<string, unknown>) ?? {};

  const updateConfig = (patch: Record<string, unknown>) => {
    setDraft((d) => ({
      ...d,
      config: { ...((d.config as Record<string, unknown>) ?? {}), ...patch },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="action-label">Nome da ação</Label>
        <Input
          id="action-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        />
      </div>

      {(actionType === "add_tag" || actionType === "remove_tag") && (
        <CatalogSelect
          label="Tag"
          loading={catalogsLoading}
          value={(config.tag_name as string) ?? ""}
          onChange={(v) => updateConfig({ tag_name: v })}
          options={catalogs.tags.map((t) => ({ value: t.name, label: t.name }))}
          emptyLabel="Nenhuma tag cadastrada. Crie em CRM → Tags."
          placeholder="Selecione uma tag"
        />
      )}

      {actionType === "move_pipeline_stage" && (
        <CatalogSelect
          label="Etapa do funil"
          loading={catalogsLoading}
          value={(config.stage_name as string) ?? ""}
          onChange={(v) => updateConfig({ stage_name: v })}
          options={catalogs.pipeline_stages.map((s) => ({
            value: s.name,
            label: s.name,
          }))}
          emptyLabel="Nenhuma etapa de funil disponível."
          placeholder="Selecione uma etapa"
        />
      )}

      {actionType === "trigger_notification" && (
        <CatalogSelect
          label="Template de notificação"
          loading={catalogsLoading}
          value={(config.template_name as string) ?? ""}
          onChange={(v) => updateConfig({ template_name: v })}
          options={catalogs.notification_templates.map((t) => ({
            value: t.name,
            label: t.name,
          }))}
          emptyLabel="Nenhum template cadastrado. Crie na aba Notificações."
          placeholder="Selecione um template"
        />
      )}

      {actionType === "create_appointment" && (
        <CatalogSelect
          label="Tipo de agendamento (opcional)"
          loading={catalogsLoading}
          value={(config.type_slug as string) ?? ""}
          onChange={(v) => updateConfig({ type_slug: v })}
          options={catalogs.agenda_services.map((s) => ({
            value: s.slug,
            label: `${s.name} (${s.duration_minutes}min)`,
          }))}
          emptyLabel="Nenhum tipo de agendamento. Configure em Agenda → Tipos."
          placeholder="A IA decide no momento"
        />
      )}

      {actionType === "send_media" && (
        <div className="space-y-1.5">
          <Label htmlFor="action-media-slug">Slug da mídia</Label>
          <Input
            id="action-media-slug"
            value={(config.slug as string) ?? ""}
            onChange={(e) => updateConfig({ slug: e.target.value })}
            placeholder="ex: catalogo-2026"
          />
          <p className="text-xs text-muted-foreground">
            Configure os arquivos em Automação → Biblioteca.
          </p>
        </div>
      )}

      {actionType === "transfer_to_user" && (
        <CatalogSelect
          label="Atendente"
          loading={catalogsLoading}
          value={(config.user as string) ?? ""}
          onChange={(v) => updateConfig({ user: v })}
          options={catalogs.members.map((m) => ({
            value: m.email ?? m.user_id,
            label: m.name + (m.email ? ` (${m.email})` : ""),
          }))}
          emptyLabel="Nenhum membro ativo na organização."
          placeholder="Selecione um membro"
        />
      )}

      {actionType === "transfer_to_agent" && (
        <CatalogSelect
          label="Outro agente"
          loading={catalogsLoading}
          value={(config.target_agent_name as string) ?? ""}
          onChange={(v) => updateConfig({ target_agent_name: v })}
          options={catalogs.other_agents.map((a) => ({
            value: a.name,
            label: a.name,
          }))}
          emptyLabel="Sem outros agentes ativos."
          placeholder="Selecione um agente"
        />
      )}

      {actionType === "stop_agent" && (
        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          Esta ação encerra a sessão da IA sem mais perguntas. Útil pra
          escapar de conversas fora de escopo.
        </div>
      )}

      {actionType === "set_lead_custom_field" && (
        <>
          <CatalogSelect
            label="Campo personalizado"
            loading={catalogsLoading}
            value={(config.field_key as string) ?? ""}
            onChange={(v) => updateConfig({ field_key: v })}
            options={catalogs.custom_fields.map((f) => ({
              value: f.field_key,
              label: `${f.name} (${f.field_type})`,
            }))}
            emptyLabel="Nenhum campo personalizado. Crie em CRM → Campos personalizados."
            placeholder="Selecione um campo"
          />
          <div className="space-y-1.5">
            <Label htmlFor="action-cf-value">Valor a salvar</Label>
            <Input
              id="action-cf-value"
              value={(config.value as string) ?? ""}
              onChange={(e) => updateConfig({ value: e.target.value })}
              placeholder="Texto literal ou {{variavel}} da conversa"
            />
            <p className="text-xs text-muted-foreground">
              Pode usar variáveis tipo <code>{"{{lead.name}}"}</code>. Tipo do
              campo (date/number/boolean) é convertido pelo CRM na leitura.
            </p>
          </div>
        </>
      )}

      {actionType === "send_whatsapp_message" && (
        <div className="space-y-1.5">
          <Label htmlFor="action-msg">Mensagem</Label>
          <Textarea
            id="action-msg"
            rows={6}
            value={(config.message as string) ?? ""}
            onChange={(e) => updateConfig({ message: e.target.value })}
            placeholder="Olá {{lead.name}}, tudo bem? Aqui é o time da empresa..."
          />
          <p className="text-xs text-muted-foreground">
            Texto literal enviado ao lead via WhatsApp, sem passar pela IA.
            Variáveis aceitas:{" "}
            <code>{"{{lead.name}}"}</code>, <code>{"{{lead.phone}}"}</code>,{" "}
            <code>{"{{lead.email}}"}</code>. Quebras de linha são preservadas.
          </p>
        </div>
      )}
    </div>
  );
}

function ConditionForm({
  draft,
  setDraft,
  catalogs,
  catalogsLoading,
}: CatalogFormProps) {
  const conditionType = draft.condition_type as string;
  const config = (draft.config as Record<string, unknown>) ?? {};

  const updateConfig = (patch: Record<string, unknown>) => {
    setDraft((d) => ({
      ...d,
      config: { ...((d.config as Record<string, unknown>) ?? {}), ...patch },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cond-label">Nome da verificação</Label>
        <Input
          id="cond-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        />
      </div>

      {conditionType === "has_tag" && (
        <CatalogSelect
          label="Tag a verificar"
          loading={catalogsLoading}
          value={(config.tag_name as string) ?? ""}
          onChange={(v) => updateConfig({ tag_name: v })}
          options={catalogs.tags.map((t) => ({ value: t.name, label: t.name }))}
          emptyLabel="Nenhuma tag cadastrada."
          placeholder="Selecione uma tag"
        />
      )}

      {conditionType === "lead_custom_field_equals" && (
        <>
          <CatalogSelect
            label="Campo personalizado"
            loading={catalogsLoading}
            value={(config.field_name as string) ?? ""}
            onChange={(v) => updateConfig({ field_name: v })}
            options={catalogs.custom_fields.map((f) => ({
              value: f.name,
              label: `${f.name} (${f.field_type})`,
            }))}
            emptyLabel="Nenhum campo personalizado cadastrado."
            placeholder="Selecione um campo"
          />
          <div className="space-y-1.5">
            <Label htmlFor="cond-value">Valor esperado</Label>
            <Input
              id="cond-value"
              value={(config.value as string) ?? ""}
              onChange={(e) => updateConfig({ value: e.target.value })}
              placeholder="ex: 18+"
            />
          </div>
        </>
      )}

      {conditionType === "in_segment" && (
        <CatalogSelect
          label="Segmentação"
          loading={catalogsLoading}
          value={(config.segment_id as string) ?? ""}
          onChange={(v) => updateConfig({ segment_id: v })}
          options={catalogs.segments.map((s) => ({
            value: s.id,
            label: s.name,
          }))}
          emptyLabel="Nenhuma segmentação cadastrada. Crie em CRM → Segmentações."
          placeholder="Selecione uma segmentação"
        />
      )}
    </div>
  );
}

// ============================================================================
// CatalogSelect — wrapper de Select com loading/empty state padronizado
// ============================================================================

interface CatalogSelectProps {
  label: string;
  loading?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  emptyLabel: string;
  placeholder: string;
}

function CatalogSelect({
  label,
  loading,
  value,
  onChange,
  options,
  emptyLabel,
  placeholder,
}: CatalogSelectProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {loading ? (
        <div className="h-9 rounded-md bg-muted animate-pulse" />
      ) : options.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
          {emptyLabel}
        </div>
      ) : (
        <Select
          value={value || undefined}
          onValueChange={(v) => onChange(v ?? "")}
        >
          <SelectTrigger>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

// Silencia warning de import tipo-only quando catalogs default não é usado.
export const _DEFAULT_CATALOGS = EMPTY_FLOW_CATALOGS;
