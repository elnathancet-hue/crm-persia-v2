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
import {
  Bell,
  BadgeCheck,
  Calendar,
  Filter,
  FileText,
  Hash,
  ImageIcon,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  Power,
  Shuffle,
  Sparkles,
  StopCircle,
  Tag as TagIcon,
  TagsIcon,
  Trash2,
  TrendingUp,
  UserCheck,
  UserCog,
  Users,
  Wand2,
  Zap,
} from "lucide-react";
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
import { FieldCard } from "./field-card";

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
    <div className="space-y-3">
      <FieldCard
        icon={Pencil}
        title="Nome desta entrada"
        description="Como esse ponto de entrada aparece no canvas."
        variant="muted"
      >
        <Input
          id="entry-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder="Conversa iniciada"
        />
      </FieldCard>

      <FieldCard
        icon={Zap}
        title="Quando o fluxo deve disparar?"
        description="Escolha o gatilho que dá início ao fluxo."
        variant="primary"
      >
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
      </FieldCard>

      {trigger === "conversation_started" && (
        <p className="text-xs text-muted-foreground px-1">
          O fluxo inicia em toda mensagem inbound do lead.
        </p>
      )}

      {trigger === "keyword_match" && (
        <FieldCard
          icon={Hash}
          title="Palavras-chave"
          description="O fluxo dispara quando o lead mandar qualquer uma."
          variant="success"
          required
        >
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
        </FieldCard>
      )}

      {trigger === "segment_entered" && (
        <FieldCard
          icon={Users}
          title="Segmentação alvo"
          description="Lead entra nesta segmentação → fluxo dispara."
          variant="progress"
          required
          helperText={
            <>
              Desenhe começando com uma ação (ex: &quot;Enviar mensagem
              WhatsApp&quot;) — não há mensagem do lead pra IA reagir aqui.
            </>
          }
        >
          {catalogsLoading ? (
            <div className="h-9 rounded-md bg-muted animate-pulse" />
          ) : catalogs.segments.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
              Nenhuma segmentação cadastrada.
            </div>
          ) : (
            <Select
              value={(config.segment_id as string) || undefined}
              onValueChange={(v) => updateConfig({ segment_id: v ?? "" })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma segmentação">
                  {catalogs.segments.find((s) => s.id === config.segment_id)?.name ??
                    "Selecione uma segmentação"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {catalogs.segments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FieldCard>
      )}

      {trigger === "pipeline_stage_entered" && (
        <FieldCard
          icon={TrendingUp}
          title="Etapa do funil alvo"
          description="Lead entra nesta etapa → fluxo dispara."
          variant="progress"
          required
          helperText={
            <>
              Desenhe começando com uma ação (ex: &quot;Enviar mensagem
              WhatsApp&quot;) — não há mensagem do lead pra IA reagir aqui.
            </>
          }
        >
          {catalogsLoading ? (
            <div className="h-9 rounded-md bg-muted animate-pulse" />
          ) : catalogs.pipeline_stages.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
              Nenhuma etapa configurada.
            </div>
          ) : (
            <Select
              value={(config.stage_id as string) || undefined}
              onValueChange={(v) => updateConfig({ stage_id: v ?? "" })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma etapa">
                  {catalogs.pipeline_stages.find((s) => s.id === config.stage_id)?.name ??
                    "Selecione uma etapa"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {catalogs.pipeline_stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.pipeline_name ? `${s.pipeline_name} › ${s.name}` : s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FieldCard>
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

  // Fix mai/2026: helpers que explicam comportamento real do runtime.
  // Antes a UI dizia "A IA segue essas instruções + o prompt geral" mas
  // o cliente nao percebia que o campo era OPCIONAL e tentava colar o
  // prompt geral aqui (confusao reportada testando o template).
  // Agora o helper text reflete dinamicamente o estado:
  //   - vazio → "Usando o prompt geral do agente" (verde, claro)
  //   - preenchido → "Soma ao prompt geral nesta etapa"
  const systemPromptValue = (draft.system_prompt as string) ?? "";
  const hasLocalPrompt = systemPromptValue.trim().length > 0;

  return (
    <div className="space-y-3">
      <FieldCard
        icon={Pencil}
        title="Nome da etapa"
        description="Rótulo do card no canvas — a IA não vê."
        variant="muted"
      >
        <Input
          id="ai-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          placeholder="Ex: Qualificação inicial"
        />
      </FieldCard>

      <FieldCard
        icon={Wand2}
        title="Instrução desta etapa"
        description="Especialize o comportamento da IA neste ponto do funil."
        variant="primary"
        optional
        helperText={
          hasLocalPrompt ? (
            <>
              <span className="font-medium text-foreground">Nesta etapa</span> a
              IA usa o <span className="font-medium">prompt geral do agente +
              esta instrução</span> juntos.
            </>
          ) : (
            <span className="text-success inline-flex items-center gap-1">
              <span aria-hidden>✓</span>
              Usando o <span className="font-medium">prompt geral</span> do
              agente (Configurações → Comportamento).
            </span>
          )
        }
      >
        <Textarea
          id="ai-prompt"
          value={systemPromptValue}
          onChange={(e) =>
            setDraft((d) => ({ ...d, system_prompt: e.target.value }))
          }
          placeholder="Deixe vazio pra usar só o prompt geral do agente.&#10;&#10;Preencha pra especializar a IA NESTA etapa do funil. Ex: 'Aqui descubra o orçamento do lead. Não fale de preço ainda — só pergunte qual a faixa que ele tem em mente'."
          rows={6}
          className="text-xs"
        />
      </FieldCard>

      <FieldCard
        icon={Sparkles}
        title="Próximos passos do fluxo"
        description="Saídas nomeadas que a IA pode disparar."
        variant="success"
        helperText="Cada saída vira um caminho no canvas. Quando a IA atender o critério, sinaliza a saída e o fluxo segue por ela."
      >
        <div className="flex items-center justify-end -mt-1 mb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addInstruction}
          >
            <Plus className="size-3.5 mr-1" />
            Adicionar saída
          </Button>
        </div>
        {instructions.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
            Sem saídas configuradas. A IA continua pelo caminho padrão
            (handle &quot;continua&quot; do card) toda vez que responder.
          </div>
        ) : (
          <div className="space-y-2">
            {instructions.map((ins, idx) => (
              <div
                key={ins.id}
                className="rounded-md border border-border bg-background p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <Label className="text-[11px]">Saída #{idx + 1}</Label>
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
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Nome técnico
                  </Label>
                  <Input
                    value={ins.output_handle}
                    onChange={(e) =>
                      updateInstruction(idx, { output_handle: e.target.value })
                    }
                    placeholder="qualificado"
                    className="h-7 text-xs font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Identificador interno. Use letras minúsculas e _ (ex:
                    qualificado, agendou, recusou).
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Quando a IA deve disparar esta saída?{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    value={ins.description}
                    onChange={(e) =>
                      updateInstruction(idx, { description: e.target.value })
                    }
                    placeholder="Ex: 'Quando o lead confirmar interesse + informar prazo + responder pelo menos 3 mensagens.'"
                    rows={2}
                    className="text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Critério que a IA usa pra decidir. Sem descrição clara, a
                    IA nunca sai desta etapa.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </FieldCard>
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
    <div className="space-y-3">
      <FieldCard
        icon={Pencil}
        title="Nome da ação"
        description="Rótulo do card no canvas."
        variant="muted"
      >
        <Input
          id="action-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        />
      </FieldCard>

      {actionType === "add_tag" && (
        <FieldCard
          icon={TagIcon}
          title="Adicionar tag"
          description="Tag a marcar no lead."
          variant="success"
          required
        >
          {renderTagSelect(catalogs, catalogsLoading, config.tag_name as string, (v) =>
            updateConfig({ tag_name: v }),
          )}
        </FieldCard>
      )}

      {actionType === "remove_tag" && (
        <FieldCard
          icon={TagsIcon}
          title="Remover tag"
          description="Tag a remover do lead."
          variant="destructive"
          required
        >
          {renderTagSelect(catalogs, catalogsLoading, config.tag_name as string, (v) =>
            updateConfig({ tag_name: v }),
          )}
        </FieldCard>
      )}

      {actionType === "move_pipeline_stage" && (
        <PipelineStagePicker
          loading={catalogsLoading}
          stageId={(config.stage_id as string) ?? ""}
          stages={catalogs.pipeline_stages}
          onChange={(stageId, pipelineId) =>
            updateConfig({ stage_id: stageId, pipeline_id: pipelineId })
          }
        />
      )}

      {actionType === "trigger_notification" && (
        <FieldCard
          icon={Bell}
          title="Template de notificação"
          description="Mensagem template a ser disparada."
          variant="progress"
          required
        >
          {renderSimpleSelect({
            loading: catalogsLoading,
            value: (config.template_name as string) ?? "",
            onChange: (v) => updateConfig({ template_name: v }),
            options: catalogs.notification_templates.map((t) => ({
              value: t.name,
              label: t.name,
            })),
            emptyLabel: "Nenhum template cadastrado. Crie na aba Notificações.",
            placeholder: "Selecione um template",
          })}
        </FieldCard>
      )}

      {actionType === "create_appointment" && (
        <>
          {/*
            PR-6 Auditoria (mai/2026): endereca decisao do plano da rodada 4
            #alta — "completar form com start_at + type_slug + duration_minutes".
            Antes, create_appointment como action node so tinha type_slug
            opcional — handler exigia start_at e falhava em runtime quando
            usado deterministicamente. Agora o admin define quando o
            appointment e criado.
          */}
          <FieldCard
            icon={Calendar}
            title="Data e hora"
            description="Em UTC. Para 14:00 em São Paulo, use 17:00 aqui."
            variant="primary"
            required
          >
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
          </FieldCard>
          <FieldCard
            icon={ListChecks}
            title="Tipo de agendamento"
            description="Herda duração, canal e local do tipo selecionado."
            variant="muted"
            optional
          >
            {renderSimpleSelect({
              loading: catalogsLoading,
              value: (config.type_slug as string) ?? "",
              onChange: (v) => updateConfig({ type_slug: v }),
              options: catalogs.agenda_services.map((s) => ({
                value: s.slug,
                label: `${s.name} (${s.duration_minutes}min)`,
              })),
              emptyLabel: "Nenhum tipo de agendamento. Configure em Agenda → Tipos.",
              placeholder: "A IA decide no momento",
            })}
          </FieldCard>
          <FieldCard
            icon={Pencil}
            title="Duração em minutos"
            description="Sobrescreve a duração do tipo selecionado."
            variant="muted"
            optional
          >
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
          </FieldCard>
        </>
      )}

      {actionType === "send_media" && (
        // Fix mai/2026: era Input livre. Cliente colava a URL completa
        // da API ("https://...?slug=xxx") em vez do slug, runtime nao
        // encontrava o arquivo. Picker resolve.
        <FieldCard
          icon={ImageIcon}
          title="Mídia a enviar"
          description="Arquivo do seu acervo (imagem, vídeo, PDF...)."
          variant="progress"
          required
          helperText="A IA envia o arquivo quando o fluxo passar por aqui."
        >
          {renderSimpleSelect({
            loading: catalogsLoading,
            value: (config.slug as string) ?? "",
            onChange: (v) => updateConfig({ slug: v }),
            options: catalogs.media_library.map((m) => ({
              value: m.slug,
              label: `${m.name} (${labelForMediaCategory(m.category)})`,
            })),
            emptyLabel:
              "Nenhuma mídia cadastrada. Acesse Automação → Biblioteca de mídia.",
            placeholder: "Selecione uma mídia",
          })}
        </FieldCard>
      )}

      {actionType === "transfer_to_user" && (
        <FieldCard
          icon={UserCheck}
          title="Atendente"
          description="Lead é atribuído a este membro e a IA pausa."
          variant="muted"
          required
        >
          {renderSimpleSelect({
            loading: catalogsLoading,
            value: (config.user as string) ?? "",
            onChange: (v) => updateConfig({ user: v }),
            options: catalogs.members.map((m) => ({
              value: m.email ?? m.user_id,
              label: m.name + (m.email ? ` (${m.email})` : ""),
            })),
            emptyLabel: "Nenhum membro ativo na organização.",
            placeholder: "Selecione um membro",
          })}
        </FieldCard>
      )}

      {actionType === "transfer_to_agent" && (
        <FieldCard
          icon={UserCog}
          title="Outro agente IA"
          description="Transfere a conversa pra outro agente."
          variant="muted"
          required
        >
          {renderSimpleSelect({
            loading: catalogsLoading,
            value: (config.target_agent_name as string) ?? "",
            onChange: (v) => updateConfig({ target_agent_name: v }),
            options: catalogs.other_agents.map((a) => ({
              value: a.name,
              label: a.name,
            })),
            emptyLabel: "Sem outros agentes ativos.",
            placeholder: "Selecione um agente",
          })}
        </FieldCard>
      )}

      {actionType === "stop_agent" && (
        <FieldCard
          icon={StopCircle}
          title="Encerrar IA"
          description="Pausa o agente sem mais perguntas."
          variant="destructive"
        >
          <p className="text-xs text-muted-foreground">
            Útil pra escapar de conversas fora do escopo do agente.
            A IA volta a responder no próximo gatilho de entrada do fluxo.
          </p>
        </FieldCard>
      )}

      {actionType === "set_lead_custom_field" && (
        <>
          <FieldCard
            icon={Pencil}
            title="Campo personalizado"
            description="Campo do lead que será atualizado."
            variant="muted"
            required
          >
            {renderSimpleSelect({
              loading: catalogsLoading,
              value: (config.field_key as string) ?? "",
              onChange: (v) => updateConfig({ field_key: v }),
              options: catalogs.custom_fields.map((f) => ({
                value: f.field_key,
                label: `${f.name} (${f.field_type})`,
              })),
              emptyLabel:
                "Nenhum campo personalizado. Crie em CRM → Campos personalizados.",
              placeholder: "Selecione um campo",
            })}
          </FieldCard>
          <FieldCard
            icon={FileText}
            title="Valor a salvar"
            description="Aceita variáveis da conversa, ex: {{lead.name}}."
            variant="muted"
            required
            helperText={
              <>
                Pode usar variáveis tipo <code>{"{{lead.name}}"}</code>. Tipo
                do campo (date/number/boolean) é convertido pelo CRM na leitura.
              </>
            }
          >
            <Input
              id="action-cf-value"
              value={(config.value as string) ?? ""}
              onChange={(e) => updateConfig({ value: e.target.value })}
              placeholder="Texto literal ou {{variavel}} da conversa"
            />
          </FieldCard>
        </>
      )}

      {actionType === "send_whatsapp_message" && (
        <FieldCard
          icon={MessageCircle}
          title="Mensagem WhatsApp"
          description="Texto literal enviado ao lead — sem passar pela IA."
          variant="primary"
          required
          helperText={
            <>
              Variáveis aceitas: <code>{"{{lead.name}}"}</code>,{" "}
              <code>{"{{lead.phone}}"}</code>, <code>{"{{lead.email}}"}</code>.
              Quebras de linha são preservadas.
            </>
          }
        >
          <Textarea
            id="action-msg"
            rows={6}
            value={(config.message as string) ?? ""}
            onChange={(e) => updateConfig({ message: e.target.value })}
            placeholder="Olá {{lead.name}}, tudo bem? Aqui é o time da empresa..."
          />
        </FieldCard>
      )}

      {actionType === "round_robin_user" && (
        <FieldCard
          icon={Shuffle}
          title="Round-robin (rodízio)"
          description="Próximo atendente disponível, distribuído por carga."
          variant="success"
        >
          <div className="text-xs text-muted-foreground space-y-2">
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
        </FieldCard>
      )}
    </div>
  );
}

// Helpers locais — selects e tag picker reusados pelos action types.
// Mantemos `CatalogSelect` (label propria + container interno) pros
// casos legacy, mas FieldCard ja prove header colorido + helper, entao
// inside-FieldCard renderizamos so o select cru.

function renderSimpleSelect(props: {
  loading?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  emptyLabel: string;
  placeholder: string;
}) {
  if (props.loading) {
    return <div className="h-9 rounded-md bg-muted animate-pulse" />;
  }
  if (props.options.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
        {props.emptyLabel}
      </div>
    );
  }
  const selectedLabel = props.options.find((o) => o.value === props.value)?.label;
  return (
    <Select
      value={props.value || undefined}
      onValueChange={(v) => props.onChange(v ?? "")}
    >
      <SelectTrigger>
        <SelectValue placeholder={props.placeholder}>
          {selectedLabel ?? props.placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {props.options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function renderTagSelect(
  catalogs: FlowCatalogs,
  loading: boolean | undefined,
  value: string | undefined,
  onChange: (v: string) => void,
) {
  return renderSimpleSelect({
    loading,
    value: value ?? "",
    onChange,
    options: catalogs.tags.map((t) => ({ value: t.name, label: t.name })),
    emptyLabel: "Nenhuma tag cadastrada. Crie em CRM → Tags.",
    placeholder: "Selecione uma tag",
  });
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
    <div className="space-y-3">
      <FieldCard
        icon={Pencil}
        title="Nome da verificação"
        description="Rótulo do card no canvas."
        variant="muted"
      >
        <Input
          id="cond-label"
          value={(draft.label as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        />
      </FieldCard>

      {conditionType === "has_tag" && (
        <FieldCard
          icon={TagIcon}
          title="Tag a verificar"
          description="Lead com esta tag segue por &quot;Sim&quot;."
          variant="progress"
          required
        >
          {renderTagSelect(catalogs, catalogsLoading, config.tag_name as string, (v) =>
            updateConfig({ tag_name: v }),
          )}
        </FieldCard>
      )}

      {conditionType === "lead_custom_field_equals" && (
        <>
          <FieldCard
            icon={Filter}
            title="Campo personalizado"
            description="Campo do lead a comparar."
            variant="progress"
            required
          >
            {renderSimpleSelect({
              loading: catalogsLoading,
              value: (config.field_name as string) ?? "",
              onChange: (v) => updateConfig({ field_name: v }),
              options: catalogs.custom_fields.map((f) => ({
                value: f.name,
                label: `${f.name} (${f.field_type})`,
              })),
              emptyLabel: "Nenhum campo personalizado cadastrado.",
              placeholder: "Selecione um campo",
            })}
          </FieldCard>
          <FieldCard
            icon={FileText}
            title="Valor esperado"
            description="Lead com este valor segue por &quot;Sim&quot;."
            variant="progress"
            required
          >
            <Input
              id="cond-value"
              value={(config.value as string) ?? ""}
              onChange={(e) => updateConfig({ value: e.target.value })}
              placeholder="ex: 18+"
            />
          </FieldCard>
        </>
      )}

      {conditionType === "in_segment" && (
        <FieldCard
          icon={Users}
          title="Segmentação"
          description="Lead dentro desta segmentação segue por &quot;Sim&quot;."
          variant="progress"
          required
        >
          {renderSimpleSelect({
            loading: catalogsLoading,
            value: (config.segment_id as string) ?? "",
            onChange: (v) => updateConfig({ segment_id: v }),
            options: catalogs.segments.map((s) => ({
              value: s.id,
              label: s.name,
            })),
            emptyLabel:
              "Nenhuma segmentação cadastrada. Crie em CRM → Segmentações.",
            placeholder: "Selecione uma segmentação",
          })}
        </FieldCard>
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

// Rotulo amigavel pra categoria de midia. Mapeia os valores que
// /automations/tools cadastra ("documento" | "imagem" | "video" | "outro")
// pros rotulos PT-BR mostrados no Select de send_media.
function labelForMediaCategory(category: string): string {
  switch (category) {
    case "imagem":
      return "imagem";
    case "video":
      return "vídeo";
    case "documento":
      return "documento";
    default:
      return "arquivo";
  }
}

interface PipelineStagePickerProps {
  loading?: boolean;
  stageId: string;
  stages: FlowCatalogs["pipeline_stages"];
  onChange: (stageId: string, pipelineId: string) => void;
}

/**
 * Picker hierarquico Funil > Etapa. Substitui o select unico de "todas
 * as etapas" que ficava bagunçado com 4+ funis (cada etapa repetia o
 * nome do funil no label, lista crescia em N*M e era dificil escanear).
 *
 * Pattern inspirado nas ferramentas similares (Jordan, ManyChat):
 *   1) Cliente escolhe o Funil
 *   2) Etapa carrega filtrada apenas pelas stages daquele funil
 *
 * Persiste so o `stage_id` (mesmo schema de antes). O pipelineId
 * exibido eh derivado consultando a stage selecionada no catalogo.
 * Trocar de funil zera o stage_id (estado fica consistente).
 */
function PipelineStagePicker({
  loading,
  stageId,
  stages,
  onChange,
}: PipelineStagePickerProps) {
  // Deriva pipelines unicos do catalogo de stages (mantem ordem original
  // — o catalogo ja vem ordenado por nome do pipeline).
  const pipelines = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const stage of stages) {
      if (!seen.has(stage.pipeline_id)) {
        seen.set(stage.pipeline_id, stage.pipeline_name || "(sem nome)");
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [stages]);

  // Pipeline selecionado: deriva do stageId quando existe (1a render
  // ou retomada de draft), com fallback pra null quando cliente nao
  // escolheu nada ainda.
  const selectedStage = stages.find((s) => s.id === stageId);
  const [pipelineId, setPipelineId] = React.useState<string>(
    selectedStage?.pipeline_id ?? "",
  );

  // Se stageId externo mudar (ex: cliente trocou de node no canvas),
  // re-deriva o pipelineId. Sem isso, o select de Funil fica "preso"
  // no antigo pipeline ate o cliente clicar nele.
  React.useEffect(() => {
    if (selectedStage && selectedStage.pipeline_id !== pipelineId) {
      setPipelineId(selectedStage.pipeline_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  const filteredStages = React.useMemo(
    () => stages.filter((s) => s.pipeline_id === pipelineId),
    [stages, pipelineId],
  );

  if (pipelines.length === 0 && !loading) {
    return (
      <FieldCard
        icon={Filter}
        title="Funil Kanban"
        description="Escolha o funil onde o lead será adicionado."
        variant="primary"
      >
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
          Nenhum funil configurado. Crie um funil em CRM → Configurações.
        </div>
      </FieldCard>
    );
  }

  return (
    <div className="space-y-3">
      <FieldCard
        icon={Filter}
        title="Funil Kanban"
        description="Escolha o funil onde o lead será adicionado."
        variant="primary"
        required
      >
        {loading ? (
          <div className="h-9 rounded-md bg-muted animate-pulse" />
        ) : (
          <Select
            value={pipelineId || undefined}
            onValueChange={(v) => {
              const next = v ?? "";
              setPipelineId(next);
              // Trocar de funil zera o stage_id — etapa antiga nao pertence
              // ao novo funil. Cliente precisa escolher de novo.
              if (next !== selectedStage?.pipeline_id) {
                onChange("", next);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o funil">
                {pipelines.find((p) => p.id === pipelineId)?.name ?? "Selecione o funil"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FieldCard>
      <FieldCard
        icon={ListChecks}
        title="Etapa do funil"
        description="Defina em qual etapa do funil o lead será posicionado."
        variant="progress"
        required
        helperText="A IA precisa que o lead já esteja neste funil pra mover a etapa dar certo."
      >
        {loading ? (
          <div className="h-9 rounded-md bg-muted animate-pulse" />
        ) : !pipelineId ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
            Escolha um funil acima primeiro.
          </div>
        ) : filteredStages.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic">
            Esse funil não tem etapas cadastradas.
          </div>
        ) : (
          <Select
            value={stageId || undefined}
            onValueChange={(v) => {
              const nextStageId = v ?? "";
              const nextStage = stages.find((s) => s.id === nextStageId);
              onChange(nextStageId, nextStage?.pipeline_id ?? pipelineId);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione a etapa">
                {filteredStages.find((s) => s.id === stageId)?.name ?? "Selecione a etapa"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {filteredStages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FieldCard>
    </div>
  );
}
