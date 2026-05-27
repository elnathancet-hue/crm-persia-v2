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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@persia/ui/alert-dialog";
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

const ENTRY_TRIGGER_LABELS: Record<string, string> = {
  conversation_started: "Em qualquer mensagem do lead",
  keyword_match: "Quando lead mandar palavra-chave",
  segment_entered: "Quando lead entrar em segmentação (em breve)",
  pipeline_stage_entered: "Quando lead entrar em etapa do funil (em breve)",
};

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
  // PR 17 UX (mai/2026): substitui confirm() nativo por AlertDialog
  // do design system. Mais consistente com o resto da UI.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  React.useEffect(() => {
    if (node) setDraft({ ...(node.data as Record<string, unknown>) });
  }, [node]);

  if (!node) return null;

  const handleSave = () => {
    onSave(node.id, draft);
    onOpenChange(false);
    toast.success("Configuração salva.");
  };

  const handleConfirmDelete = () => {
    if (!onDelete) return;
    onDelete(node.id);
    setConfirmDeleteOpen(false);
    onOpenChange(false);
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
            <EntryForm
              draft={draft}
              setDraft={setDraft}
              catalogs={catalogs}
              catalogsLoading={catalogsLoading}
            />
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
              onClick={() => setConfirmDeleteOpen(true)}
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

      {/* PR 17 UX (mai/2026): AlertDialog substitui confirm() nativo */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover esta tarefa do fluxo?</AlertDialogTitle>
            <AlertDialogDescription>
              A tarefa será apagada do canvas. Conexões com outras tarefas
              também são removidas. Você pode adicionar novamente depois pela
              lateral.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function sheetTitle(node: FlowNode): string {
  // PR 17 UX (mai/2026): linguagem natural sem jargão de runtime.
  // "node de IA" → "atendimento com IA" / "ação automática" → "ação".
  switch (node.type) {
    case "entry":
      return "entrada do fluxo";
    case "ai_agent":
      return "atendimento com IA";
    case "action":
      return "ação";
    case "condition":
      return "verificação";
  }
}

// ============================================================================
// Forms por tipo
// ============================================================================

export interface FormProps {
  draft: Record<string, unknown>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}

export interface CatalogFormProps extends FormProps {
  catalogs: FlowCatalogs;
  catalogsLoading?: boolean;
}

export function EntryForm({
  draft,
  setDraft,
  catalogs,
  catalogsLoading,
}: CatalogFormProps) {
  const trigger = (draft.trigger as string) ?? "conversation_started";
  const config = (draft.config as Record<string, unknown>) ?? {};

  const updateConfig = (patch: Record<string, unknown>) => {
    setDraft((d) => ({
      ...d,
      config: { ...((d.config as Record<string, unknown>) ?? {}), ...patch },
    }));
  };

  // PR 10 (mai/2026): troca de trigger reseta config — campos do tipo
  // antigo viram lixo, melhor zerar.
  const setTrigger = (newTrigger: string | null) => {
    if (!newTrigger) return;
    const freshConfig: Record<string, unknown> =
      newTrigger === "keyword_match"
        ? { keywords: [] as string[] }
        : newTrigger === "segment_entered"
          ? { segment_id: "" }
          : newTrigger === "pipeline_stage_entered"
            ? { stage_id: "" }
            : {};
    setDraft((d) => ({ ...d, trigger: newTrigger, config: freshConfig }));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="entry-label">Nome desta entrada</Label>
        <Input
          id="entry-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder="Conversa iniciada"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="entry-trigger">Quando o fluxo deve disparar?</Label>
        <Select value={trigger} onValueChange={setTrigger}>
          <SelectTrigger id="entry-trigger">
            <SelectValue placeholder="Selecione um gatilho">
              {ENTRY_TRIGGER_LABELS[trigger] ?? "Selecione um gatilho"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="conversation_started">
              Em qualquer mensagem do lead
            </SelectItem>
            <SelectItem value="keyword_match">
              Quando lead mandar palavra-chave
            </SelectItem>
            <SelectItem value="segment_entered">
              Quando lead entrar em segmentação (em breve)
            </SelectItem>
            <SelectItem value="pipeline_stage_entered">
              Quando lead entrar em etapa do funil (em breve)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {trigger === "conversation_started" && (
        <p className="text-xs text-muted-foreground">
          O fluxo inicia em toda mensagem inbound do lead.
        </p>
      )}

      {trigger === "keyword_match" && (
        <KeywordListField
          value={
            Array.isArray(config.keywords)
              ? (config.keywords as unknown[]).filter(
                  (k): k is string => typeof k === "string",
                )
              : []
          }
          onChange={(keywords) => updateConfig({ keywords })}
        />
      )}

      {trigger === "segment_entered" && (
        <>
          <CatalogSelect
            label="Segmentação alvo"
            loading={catalogsLoading}
            value={(config.segment_id as string) ?? ""}
            onChange={(v) => updateConfig({ segment_id: v })}
            options={catalogs.segments.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
            emptyLabel="Nenhuma segmentação cadastrada."
            placeholder="Selecione uma segmentação"
          />
          <p className="text-xs text-muted-foreground">
            O fluxo dispara quando o lead começa a casar com as regras
            desta segmentação (após criar lead, mudar tags ou atualizar
            campos). Desenhe começando com uma ação (ex: &quot;Enviar
            mensagem WhatsApp&quot;) porque não há mensagem do lead pra IA
            reagir.
          </p>
        </>
      )}

      {trigger === "pipeline_stage_entered" && (
        <>
          <CatalogSelect
            label="Etapa do funil alvo"
            loading={catalogsLoading}
            value={(config.stage_id as string) ?? ""}
            onChange={(v) => updateConfig({ stage_id: v })}
            options={catalogs.pipeline_stages.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
            emptyLabel="Nenhuma etapa configurada."
            placeholder="Selecione uma etapa"
          />
          <p className="text-xs text-muted-foreground">
            O fluxo dispara quando o lead entra nesta etapa — seja por
            drag no Kanban ou via outro agente. Desenhe começando com uma
            ação (ex: &quot;Enviar mensagem WhatsApp&quot;) porque não há
            mensagem do lead pra IA reagir.
          </p>
        </>
      )}
    </div>
  );
}

// PR 10 (mai/2026): editor de keywords (chips removíveis + input de novo).
function KeywordListField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [pending, setPending] = React.useState("");

  const add = () => {
    const trimmed = pending.trim();
    if (!trimmed) return;
    if (value.some((k) => k.toLowerCase() === trimmed.toLowerCase())) {
      setPending("");
      return; // duplicada — ignora silencioso
    }
    onChange([...value, trimmed]);
    setPending("");
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-1.5">
      <Label>Palavras-chave que disparam o fluxo</Label>
      <div className="flex gap-2">
        <Input
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Ex: comprar, agendar, orçamento"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={add}
          disabled={!pending.trim()}
        >
          Adicionar
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Adicione palavras (uma de cada vez). O fluxo dispara quando a
          mensagem do lead contiver qualquer uma delas (case-insensitive).
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.map((kw, idx) => (
            <span
              key={`${kw}-${idx}`}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
            >
              {kw}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(idx)}
                className="!size-4 text-muted-foreground hover:text-destructive"
                aria-label={`Remover "${kw}"`}
              >
                ×
              </Button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function AIAgentForm({ draft, setDraft }: FormProps) {
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

export function ActionForm({
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
        <>
          {/*
            PR-6 Auditoria (mai/2026): endereca decisao do plano da rodada 4
            #alta — "completar form com start_at + type_slug + duration_minutes".
            Antes, create_appointment como action node so tinha type_slug
            opcional — handler exigia start_at e falhava em runtime quando
            usado deterministicamente (Codex marcou como "inviavel como
            action determinante atual"). Agora o admin define quando o
            appointment e criado.

            Campos:
              - start_at (datetime-local + Z UTC): instante absoluto.
                Tradeoff V1: timezone UTC assumido. Sem suporte a relative
                offset ("+24h") ainda — exige modelo de variaveis no flow.
              - type_slug (dropdown): herda duration/channel/location.
              - duration_minutes: sobrescreve duracao do type_slug.
          */}
          <div className="space-y-1.5">
            <Label htmlFor="action-appointment-start">Data e hora</Label>
            <Input
              id="action-appointment-start"
              type="datetime-local"
              value={
                typeof config.start_at === "string"
                  ? (config.start_at as string).replace(/(:\d{2})?\.\d{3}Z$/, "").slice(0, 16)
                  : ""
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw) {
                  updateConfig({ start_at: undefined });
                  return;
                }
                // datetime-local entrega "YYYY-MM-DDTHH:mm" sem timezone —
                // anexamos ":00.000Z" pra virar ISO UTC valido (o handler
                // usa z.string().datetime({offset:true})).
                updateConfig({ start_at: `${raw}:00.000Z` });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Em UTC. Para 14:00 em São Paulo, use 17:00 aqui.
            </p>
          </div>
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
          <div className="space-y-1.5">
            <Label htmlFor="action-appointment-duration">
              Duração em minutos (opcional)
            </Label>
            <Input
              id="action-appointment-duration"
              type="number"
              min={15}
              max={480}
              step={15}
              value={
                typeof config.duration_minutes === "number"
                  ? config.duration_minutes
                  : ""
              }
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw) {
                  updateConfig({ duration_minutes: undefined });
                  return;
                }
                const n = parseInt(raw, 10);
                if (Number.isFinite(n)) updateConfig({ duration_minutes: n });
              }}
              placeholder="Sobrescreve duração do tipo selecionado"
            />
          </div>
        </>
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

      {actionType === "round_robin_user" && (
        <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
          <p>
            O lead é atribuído ao membro da equipe com MENOS leads ativos
            no momento (algoritmo &quot;least-loaded&quot;).
          </p>
          <p>
            Candidatos: todos com perfil <strong>Atendente</strong>,{" "}
            <strong>Admin</strong> ou <strong>Owner</strong> ativos. Quem
            tiver papel <strong>Viewer</strong> não recebe leads.
          </p>
          <p>
            Após atribuir, o agente IA é pausado automaticamente nessa
            conversa (humano assumiu).
          </p>
        </div>
      )}
    </div>
  );
}

export function ConditionForm({
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
  const selectedLabel = options.find((opt) => opt.value === value)?.label;

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
            <SelectValue placeholder={placeholder}>
              {selectedLabel ?? placeholder}
            </SelectValue>
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
