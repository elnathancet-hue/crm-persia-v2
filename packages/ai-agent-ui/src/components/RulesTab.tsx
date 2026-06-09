"use client";

// PR 22 (mai/2026): RulesTab passou por uma limpeza grande.
//   - Removido HandoffNotificationCard: notificação de handoff agora é
//     configurada no Fluxo (Action node trigger_notification).
//   - Removido QuickToolsCard: tools ligadas agora vivem dentro dos nodes
//     do Fluxo (cada IA + Action node tem a sua).
//   - Agenda virou 1 picker único (CRM interna + Google se conectado),
//     em vez de 2 cards "ativa" / "em breve" (Google já está em prod).
//   - Adicionado PromptBuilderSection com 2 modos: texto corrido ou
//     por partes (Persona, Missão, Regras, Estilo, Conhecimento).
//
// Estado dos campos de handoff_notification_* foi mantido no agent
// (DB) — só removemos a UI. Configuração existente em agentes legados
// continua funcionando via Fluxo.
//
// PR 26 (mai/2026): auto-save introduzido — reverted no PR 27.
// PR 27 (mai/2026): botão "Salvar alterações" voltou. Cliente preferiu
// fluxo manual — auto-save dá sensação de "perdi o controle" mesmo
// com indicator visual. Em troca, useUnsavedChangesGuard avisa ao
// tentar sair da tela com `dirty=true`, prevenindo perda acidental.

import * as React from "react";
import {
  Brain,
  CalendarCheck,
  CheckCircle2,
  Download,
  Image,
  ExternalLink,
  HelpCircle,
  MessageSquare,
  Minus,
  Pencil,
  Plug,
  Plus,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type {
  AgentCalendarConnectionPublic,
  AgentConfig,
  AgentGuardrails,
  AgentKnowledgeSource,
  AgentTool,
  MessageTemplate,
  UpdateAgentInput,
  ValidationConfig,
} from "@persia/shared/ai-agent";
import {
  AFTER_HOURS_MESSAGE_DEFAULT,
  AFTER_HOURS_MESSAGE_MAX_LENGTH,
  AUTO_PAUSE_MINUTES_DEFAULT,
  AUTO_PAUSE_MINUTES_MAX,
  BUSINESS_HOURS_DEFAULT,
  DAY_NAMES,
  DEBOUNCE_WINDOW_MS_DEFAULT,
  DEBOUNCE_WINDOW_MS_MAX,
  DEBOUNCE_WINDOW_MS_MIN,
  PAUSE_KEYWORDS_DEFAULT,
  RESUME_KEYWORDS_DEFAULT,
  SPLIT_DELAY_SECONDS_DEFAULT,
  SPLIT_DELAY_SECONDS_MAX,
  SPLIT_DELAY_SECONDS_MIN,
  SPLIT_THRESHOLD_CHARS_DEFAULT,
  SPLIT_THRESHOLD_CHARS_MAX,
  SPLIT_THRESHOLD_CHARS_MIN,
  clampAutoPauseMinutes,
  clampDebounceWindowMs,
  clampSplitDelaySeconds,
  clampSplitThresholdChars,
  normalizeHumanizationConfig,
  normalizeValidationConfig,
  sanitizeBusinessHours,
  sanitizeKeywordList,
  type BusinessHours,
  type DayHours,
  type DayName,
} from "@persia/shared/ai-agent";
import { EntryConditionsCard } from "./EntryConditionsCard";
import { DocumentsTab } from "./DocumentsTab";
import { PromptBuilderSection } from "./PromptBuilderSection";
import { UnsavedChangesGuard } from "./use-unsaved-changes-guard";
import { useAgentActions } from "../context";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@persia/ui/accordion";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Switch } from "@persia/ui/switch";
import { Input } from "@persia/ui/input";
import { Slider } from "@persia/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@persia/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import type { FlowCatalogs } from "./flow/catalog-types";

interface Props {
  agent: AgentConfig;
  onChange: (patch: UpdateAgentInput, successMsg?: string) => void;
  isPending: boolean;
  // PR 22 (mai/2026): tools/onToolsChange ainda passados pelo AgentEditor
  // por compatibilidade de assinatura. RulesTab não renderiza mais
  // QuickToolsCard (tools agora vivem nos nodes do Fluxo) — props ficam
  // no-op aqui pra não quebrar o caller. Próximo PR remove a prop.
  tools: AgentTool[];
  onToolsChange: (next: AgentTool[]) => void;
  knowledgeSources: AgentKnowledgeSource[];
  onKnowledgeSourcesChange: (next: AgentKnowledgeSource[]) => void;
  onKnowledgeRefresh: () => Promise<void>;
  onSaveControlChange?: (
    control: {
      dirty: boolean;
      isPending: boolean;
      onSave: () => void;
    } | null,
  ) => void;
}

const DEBOUNCE_PRESETS = [
  { label: "Agora", valueMs: 0 },
  { label: "Natural", valueMs: 10_000 },
  { label: "Paciente", valueMs: 20_000 },
  { label: "Longo", valueMs: 40_000 },
] as const;

const AUTO_PAUSE_PRESETS = [
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "1h", value: 60 },
  { label: "4h", value: 240 },
  { label: "24h", value: 1440 },
] as const;

const SPLIT_THRESHOLD_PRESETS = [
  { label: "Curta", value: 240 },
  { label: "Padrao", value: SPLIT_THRESHOLD_CHARS_DEFAULT },
  { label: "Longa", value: 520 },
] as const;

export function RulesTab({
  agent,
  onChange,
  isPending,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tools: _tools,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onToolsChange: _onToolsChange,
  knowledgeSources,
  onKnowledgeSourcesChange,
  onKnowledgeRefresh,
  onSaveControlChange,
}: Props) {
  const [name, setName] = React.useState(agent.name);
  const [prompt, setPrompt] = React.useState(agent.system_prompt);
  const [description, setDescription] = React.useState(agent.description ?? "");
  const [model, setModel] = React.useState(agent.model);
  const [guardrails, setGuardrails] = React.useState<AgentGuardrails>(agent.guardrails);
  const [calendarConnectionId, setCalendarConnectionId] = React.useState<
    string | null
  >(agent.calendar_connection_id ?? null);
  const [calendarConnections, setCalendarConnections] = React.useState<
    AgentCalendarConnectionPublic[] | null
  >(null);

  // PR-AI-AGENT-HUMAN-A: humanization (pausa/ativa). UI usa textareas
  // pra editar keywords como texto livre (1 por linha) — mais intuitivo
  // que multi-input. Persistencia normaliza via sanitizeKeywordList.
  //
  // PR 22 (mai/2026): handoff_include_summary continua persistido aqui
  // (parte de humanization_config) por compat com agentes legados, mas
  // sem UI exposta (default true). Action node trigger_notification
  // controla o resumo no Fluxo.
  const initialHumanization = React.useMemo(
    () => normalizeHumanizationConfig(agent.humanization_config),
    [agent.humanization_config],
  );
  const [humanizationEnabled, setHumanizationEnabled] = React.useState<boolean>(
    initialHumanization.auto_pause_minutes > 0,
  );
  const [autoPauseMinutes, setAutoPauseMinutes] = React.useState<number>(
    initialHumanization.auto_pause_minutes > 0
      ? initialHumanization.auto_pause_minutes
      : AUTO_PAUSE_MINUTES_DEFAULT,
  );
  const [pauseKeywordsText, setPauseKeywordsText] = React.useState<string>(
    initialHumanization.pause_keywords.join("\n"),
  );
  const [resumeKeywordsText, setResumeKeywordsText] = React.useState<string>(
    initialHumanization.resume_keywords.join("\n"),
  );
  const [splitEnabled, setSplitEnabled] = React.useState<boolean>(
    initialHumanization.split_enabled,
  );
  const [splitThresholdChars, setSplitThresholdChars] = React.useState<number>(
    initialHumanization.split_threshold_chars,
  );
  const [splitDelaySeconds, setSplitDelaySeconds] = React.useState<number>(
    initialHumanization.split_delay_seconds,
  );
  const [businessHoursEnabled, setBusinessHoursEnabled] = React.useState<boolean>(
    initialHumanization.business_hours_enabled,
  );
  const [businessHours, setBusinessHours] = React.useState<BusinessHours>(
    initialHumanization.business_hours,
  );
  const [afterHoursMessage, setAfterHoursMessage] = React.useState<string>(
    initialHumanization.after_hours_message,
  );
  const [debounceWindowMs, setDebounceWindowMs] = React.useState<number>(
    clampDebounceWindowMs(agent.debounce_window_ms),
  );
  const [newLeadStageId, setNewLeadStageId] = React.useState<string | null>(
    agent.new_lead_stage_id ?? null,
  );
  // Migration 100: templates de mensagem reutilizáveis.
  const [templates, setTemplates] = React.useState<MessageTemplate[]>(
    agent.message_templates ?? [],
  );
  const [importModalOpen, setImportModalOpen] = React.useState(false);

  // Migration 101: validacao antes do envio.
  const [validationConfig, setValidationConfig] = React.useState<ValidationConfig>(
    () => normalizeValidationConfig(agent.validation_config),
  );
  const [selectedPipelineId, setSelectedPipelineId] = React.useState<string | null>(
    null,
  );
  const [pipelineStages, setPipelineStages] = React.useState<
    FlowCatalogs["pipeline_stages"]
  >([]);
  const [catalogsLoaded, setCatalogsLoaded] = React.useState(false);

  const { listCalendarConnections, getFlowCatalogs } = useAgentActions();

  // Load connections once. Re-runs only if agent.id changes (não quando
  // o user salva, porque a lista vive em outro escopo).
  React.useEffect(() => {
    let cancelled = false;
    listCalendarConnections()
      .then((list) => {
        if (!cancelled) setCalendarConnections(list);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : "Falha ao carregar calendários",
          );
          setCalendarConnections([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listCalendarConnections]);

  React.useEffect(() => {
    let cancelled = false;
    getFlowCatalogs(agent.id)
      .then((catalogs) => {
        if (cancelled) return;
        setPipelineStages(catalogs.pipeline_stages);
        setCatalogsLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : "Falha ao carregar etapas do CRM",
          );
          setPipelineStages([]);
          setCatalogsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id, getFlowCatalogs]);

  // Save flow fix #1 (mai/2026): preserva input do cliente durante save.
  //
  // Antes: este useEffect ressincronizava state local SEMPRE que agent.*
  // mudava. Race condition: cliente digitando enquanto save retorna do
  // server -> setAgent triggera resync -> input fresco do cliente eh
  // sobrescrito pela versao "stale" do server.
  //
  // Agora: ressincroniza apenas quando
  //   (a) agent.id mudou (cliente abriu outro agente — sempre puxa do server)
  //   (b) NAO esta dirty (cliente nao tem mudancas locais — server eh fonte)
  // Quando dirty + mesmo agente, preserva o input do cliente. Save bem
  // sucedido limpa dirty (state local = server), aí o proximo resync passa.
  const prevAgentIdRef = React.useRef<string>(agent.id);
  const dirtyRef = React.useRef(false);
  React.useEffect(() => {
    const agentChanged = prevAgentIdRef.current !== agent.id;
    prevAgentIdRef.current = agent.id;
    if (!agentChanged && dirtyRef.current) {
      // Mesma config aberta + cliente tem mudancas locais. NAO sobrescreve.
      return;
    }
    setName(agent.name);
    setPrompt(agent.system_prompt);
    setDescription(agent.description ?? "");
    setModel(agent.model);
    setGuardrails(agent.guardrails);
    setCalendarConnectionId(agent.calendar_connection_id ?? null);
    const next = normalizeHumanizationConfig(agent.humanization_config);
    setHumanizationEnabled(next.auto_pause_minutes > 0);
    setAutoPauseMinutes(
      next.auto_pause_minutes > 0 ? next.auto_pause_minutes : AUTO_PAUSE_MINUTES_DEFAULT,
    );
    setPauseKeywordsText(next.pause_keywords.join("\n"));
    setResumeKeywordsText(next.resume_keywords.join("\n"));
    setSplitEnabled(next.split_enabled);
    setSplitThresholdChars(next.split_threshold_chars);
    setSplitDelaySeconds(next.split_delay_seconds);
    setBusinessHoursEnabled(next.business_hours_enabled);
    setBusinessHours(next.business_hours);
    setAfterHoursMessage(next.after_hours_message);
    setDebounceWindowMs(clampDebounceWindowMs(agent.debounce_window_ms));
    setNewLeadStageId(agent.new_lead_stage_id ?? null);
    setSelectedPipelineId(null);
    setTemplates(agent.message_templates ?? []);
    setValidationConfig(normalizeValidationConfig(agent.validation_config));
  }, [
    agent.id,
    agent.name,
    agent.system_prompt,
    agent.description,
    agent.model,
    agent.guardrails,
    agent.calendar_connection_id,
    agent.humanization_config,
    agent.debounce_window_ms,
    agent.new_lead_stage_id,
    agent.message_templates,
    agent.validation_config,
  ]);

  const pipelineOptions = React.useMemo(() => {
    const byId = new Map<string, string>();
    for (const stage of pipelineStages) {
      if (!byId.has(stage.pipeline_id)) {
        byId.set(
          stage.pipeline_id,
          stage.pipeline_name || `Funil ${stage.pipeline_id.slice(0, 8)}`,
        );
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name }));
  }, [pipelineStages]);

  const selectedNewLeadStage = React.useMemo(
    () => pipelineStages.find((stage) => stage.id === newLeadStageId) ?? null,
    [newLeadStageId, pipelineStages],
  );

  React.useEffect(() => {
    if (selectedNewLeadStage) {
      setSelectedPipelineId(selectedNewLeadStage.pipeline_id);
    }
  }, [selectedNewLeadStage]);

  const stagesForSelectedPipeline = React.useMemo(
    () =>
      selectedPipelineId
        ? pipelineStages.filter((stage) => stage.pipeline_id === selectedPipelineId)
        : [],
    [pipelineStages, selectedPipelineId],
  );

  const nameDirty = name.trim().length > 0 && name.trim() !== agent.name;
  const promptDirty = prompt !== agent.system_prompt;
  const descriptionDirty = description !== (agent.description ?? "");
  const modelDirty = model !== agent.model;
  // PR-AI-AGENT-TOKENS-OUT (mai/2026): max_iterations, timeout_seconds,
  // cost_ceiling_tokens nao tem UI cliente — tracked apenas pra detectar
  // dirty no allow_human_handoff. Mesma logica vale pros campos
  // context_summary_* e debounce_window_ms: backend mantem defaults via
  // clamp helpers; cliente nao ajusta token economy.
  const guardrailsDirty =
    guardrails.allow_human_handoff !== agent.guardrails.allow_human_handoff;
  const calendarConnectionDirty =
    calendarConnectionId !== (agent.calendar_connection_id ?? null);
  const newLeadStageDirty =
    newLeadStageId !== (agent.new_lead_stage_id ?? null);
  const nextDebounceWindowMs = clampDebounceWindowMs(debounceWindowMs);
  const debounceDirty =
    nextDebounceWindowMs !== clampDebounceWindowMs(agent.debounce_window_ms);

  // PR-AI-AGENT-HUMAN-A: humanization dirty + sanitized comparados com
  // a versao normalizada do servidor (que tambem passa pelo helper).
  const nextPauseKeywords = sanitizeKeywordList(
    pauseKeywordsText.split("\n"),
    PAUSE_KEYWORDS_DEFAULT,
  );
  const nextResumeKeywords = sanitizeKeywordList(
    resumeKeywordsText.split("\n"),
    RESUME_KEYWORDS_DEFAULT,
  );
  const nextAutoPauseMinutes = humanizationEnabled
    ? clampAutoPauseMinutes(autoPauseMinutes)
    : 0;
  const nextSplitThresholdChars = clampSplitThresholdChars(splitThresholdChars);
  const nextSplitDelaySeconds = clampSplitDelaySeconds(splitDelaySeconds);
  // PR C: business hours dirty check. business_hours sanitiza dia-por-dia
  // (rejeita invalido). after_hours_message clipa em max length.
  const nextBusinessHours = sanitizeBusinessHours(businessHours);
  const nextAfterHoursMessage = afterHoursMessage.trim().slice(
    0,
    AFTER_HOURS_MESSAGE_MAX_LENGTH,
  ) || AFTER_HOURS_MESSAGE_DEFAULT;
  const humanizationDirty =
    nextAutoPauseMinutes !== initialHumanization.auto_pause_minutes ||
    JSON.stringify(nextPauseKeywords) !==
      JSON.stringify(initialHumanization.pause_keywords) ||
    JSON.stringify(nextResumeKeywords) !==
      JSON.stringify(initialHumanization.resume_keywords) ||
    splitEnabled !== initialHumanization.split_enabled ||
    nextSplitThresholdChars !== initialHumanization.split_threshold_chars ||
    nextSplitDelaySeconds !== initialHumanization.split_delay_seconds ||
    businessHoursEnabled !== initialHumanization.business_hours_enabled ||
    JSON.stringify(nextBusinessHours) !==
      JSON.stringify(initialHumanization.business_hours) ||
    nextAfterHoursMessage !== initialHumanization.after_hours_message;

  const templatesDirty =
    JSON.stringify(templates) !== JSON.stringify(agent.message_templates ?? []);

  const validationDirty =
    JSON.stringify(validationConfig) !==
    JSON.stringify(normalizeValidationConfig(agent.validation_config));

  const dirty =
    promptDirty ||
    nameDirty ||
    descriptionDirty ||
    modelDirty ||
    guardrailsDirty ||
    calendarConnectionDirty ||
    newLeadStageDirty ||
    debounceDirty ||
    humanizationDirty ||
    templatesDirty ||
    validationDirty;

  // Sincroniza ref do dirty pro useEffect de resync acima ler sem
  // recriar deps. Padrao "ref reflete state recente" — comum em
  // codigo que precisa ler valor atual dentro de outro effect.
  React.useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // PR 35 (mai/2026): dirty flags por accordion. UI mostra bullet
  // âmbar no header de cada accordion que tem mudança não salva,
  // pra cliente saber onde mexeu sem precisar abrir tudo.
  const decideDirty = modelDirty || guardrailsDirty;
  const converseDirty = humanizationDirty || debounceDirty;
  const integrationsDirty = calendarConnectionDirty || newLeadStageDirty;

  // PR 35 (mai/2026): accordion controlled — jump links abrem o
  // accordion correspondente quando o cliente clica num chip. Antes
  // era defaultValue (uncontrolled).
  const [openAccordions, setOpenAccordions] = React.useState<string[]>([
    "decide",
  ]);

  const jumpToAccordion = React.useCallback((id: string) => {
    // Abre o accordion se ainda não estiver aberto.
    setOpenAccordions((prev) => (prev.includes(id) ? prev : [...prev, id]));
    // setTimeout pra esperar o accordion expandir (animação ~200ms)
    // antes de scrollar — sem isso, o scrollIntoView calcula bounds
    // antes da expansão e fica errado.
    setTimeout(() => {
      const el = document.getElementById(`accordion-${id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 220);
  }, []);

  // PR 27 (mai/2026): auto-save do PR 26 foi revertido. Cliente
  // preferiu fluxo manual com botão "Salvar alterações" — feedback
  // mais previsível ("eu sei quando salva"). Pra mitigar o risco
  // de perder mudanças, useUnsavedChangesGuard abaixo avisa quando
  // tenta sair com `dirty=true`.
  const handleSave = React.useCallback(() => {
    const patch: UpdateAgentInput = {};
    if (nameDirty) patch.name = name.trim();
    if (promptDirty) patch.system_prompt = prompt;
    if (descriptionDirty) patch.description = description;
    if (modelDirty) patch.model = model;
    if (guardrailsDirty) patch.guardrails = guardrails;
    if (calendarConnectionDirty) {
      patch.calendar_connection_id = calendarConnectionId;
    }
    if (newLeadStageDirty) {
      patch.new_lead_stage_id = newLeadStageId;
    }
    if (debounceDirty) {
      patch.debounce_window_ms = nextDebounceWindowMs;
    }
    if (humanizationDirty) {
      // PR 22: handoff_include_summary preservado do valor original
      // (sem UI) — agentes legados que tinham configurado mantêm.
      patch.humanization_config = {
        pause_keywords: nextPauseKeywords,
        resume_keywords: nextResumeKeywords,
        auto_pause_minutes: nextAutoPauseMinutes,
        split_enabled: splitEnabled,
        split_threshold_chars: nextSplitThresholdChars,
        split_delay_seconds: nextSplitDelaySeconds,
        business_hours_enabled: businessHoursEnabled,
        business_hours: nextBusinessHours,
        after_hours_message: nextAfterHoursMessage,
        handoff_include_summary: initialHumanization.handoff_include_summary,
      };
    }
    if (templatesDirty) patch.message_templates = templates;
    if (validationDirty) patch.validation_config = validationConfig;
    onChange(patch, "Configurações salvas");
  }, [
    promptDirty,
    nameDirty,
    descriptionDirty,
    modelDirty,
    guardrailsDirty,
    calendarConnectionDirty,
    newLeadStageDirty,
    humanizationDirty,
    templatesDirty,
    templates,
    prompt,
    name,
    description,
    model,
    guardrails,
    calendarConnectionId,
    newLeadStageId,
    debounceDirty,
    nextDebounceWindowMs,
    nextPauseKeywords,
    nextResumeKeywords,
    nextAutoPauseMinutes,
    splitEnabled,
    nextSplitThresholdChars,
    nextSplitDelaySeconds,
    businessHoursEnabled,
    nextBusinessHours,
    nextAfterHoursMessage,
    initialHumanization.handoff_include_summary,
    validationDirty,
    validationConfig,
    onChange,
  ]);

  React.useEffect(() => {
    onSaveControlChange?.({ dirty, isPending, onSave: handleSave });
    return () => onSaveControlChange?.(null);
  }, [dirty, handleSave, isPending, onSaveControlChange]);

  return (
    /* PR 34 (mai/2026): outer wrap pra acomodar sticky save bar no
       rodapé. pb-20 reserva espaço pro bar ficar visível sem cobrir
       o último accordion.
       PR 36 (mai/2026): TooltipProvider envolve tudo pra habilitar
       help tooltips (ícone ?) em campos técnicos. delay=200ms pra
       não disparar em hover acidental. */
    <TooltipProvider delay={200}>
    <div className="space-y-5 pb-6">
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
      {/* PR 27 (mai/2026): guard pra "este projeto não foi salvo,
          deseja sair?" Combina beforeunload nativo (fechar aba/reload)
          + intercept de Link clicks (navegação interna Next.js).
          Renderiza AlertDialog customizado quando user clica em link
          interno com dirty=true. */}
      <UnsavedChangesGuard dirty={dirty} />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Configuração do agente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <EntryConditionsCard
            configId={agent.id}
            isPrimary={agent.is_primary !== false}
          />

          <div className="space-y-2">
            <Label htmlFor="agent_name">Nome</Label>
            <Input
              id="agent_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nomeie seu agente"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Adicione uma breve descrição sobre o que faz esse agente"
            />
          </div>
          {/* PR 22 (mai/2026): prompt agora tem 2 modos de edição
              (texto corrido OU por partes). Antes era só textarea
              monoespaçada — cliente leigo se perdia. Agora pode
              dividir em Persona/Missão/Regras/Estilo/Conhecimento. */}
          <PromptBuilderSection
            value={prompt}
            onChange={setPrompt}
            agentId={agent.id}
          />

          <section className="space-y-3 pt-2">
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="new_lead_stage_id">
                  CRM inicial para contato novo
                </Label>
                <HelpTooltip>
                  Quando o WhatsApp criar um lead novo por este agente, ele ja
                  entra nessa etapa do Kanban. Se deixar vazio, fica no
                  comportamento padrao atual.
                </HelpTooltip>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new_lead_pipeline_id" className="text-xs">
                    Funil
                  </Label>
                  <Select
                    value={selectedPipelineId ?? "_none"}
                    onValueChange={(value) => {
                      if (value === "_none") {
                        setSelectedPipelineId(null);
                        setNewLeadStageId(null);
                        return;
                      }
                      setSelectedPipelineId(value);
                      if (selectedNewLeadStage?.pipeline_id !== value) {
                        setNewLeadStageId(null);
                      }
                    }}
                    disabled={!catalogsLoaded}
                  >
                    <SelectTrigger id="new_lead_pipeline_id">
                      <SelectValue>
                        {selectedPipelineId
                          ? pipelineOptions.find((p) => p.id === selectedPipelineId)
                              ?.name ?? "Funil selecionado"
                          : "Sem etapa inicial"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sem etapa inicial</SelectItem>
                      {pipelineOptions.map((pipeline) => (
                        <SelectItem key={pipeline.id} value={pipeline.id}>
                          {pipeline.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new_lead_stage_id" className="text-xs">
                    Etapa inicial
                  </Label>
                  <Select
                    value={newLeadStageId ?? "_none"}
                    onValueChange={(value) =>
                      setNewLeadStageId(value === "_none" ? null : value)
                    }
                    disabled={!catalogsLoaded || !selectedPipelineId}
                  >
                    <SelectTrigger id="new_lead_stage_id">
                      <SelectValue>
                        {newLeadStageId
                          ? selectedNewLeadStage?.name ?? "Etapa selecionada"
                          : selectedPipelineId
                            ? "Selecione a etapa"
                            : "Escolha um funil"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Sem etapa inicial</SelectItem>
                      {stagesForSelectedPipeline.map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          {stage.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3 pt-4 border-t border-border">
            <div>
              <h3 className="text-sm font-semibold">Conhecimento</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Arquivos que o agente pode consultar durante a conversa.
              </p>
            </div>
            <DocumentsTab
              configId={agent.id}
              sources={knowledgeSources}
              onChange={onKnowledgeSourcesChange}
              onRefresh={onKnowledgeRefresh}
            />
          </section>

          <section className="space-y-2 border-t border-border pt-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Templates de mensagem</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Textos prontos reutilizáveis nos nodes do Fluxo. Sugestão para IA ou resposta fixa sem IA.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const tempKey = `tpl_new_${Date.now()}`;
                    setTemplates((prev) => [
                      ...prev,
                      { key: tempKey, name: "", mode: "ai_suggestion", message: "" },
                    ]);
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  <Plus className="size-3.5" />
                  Novo template
                </button>
                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  <Upload className="size-3.5" />
                  Importar JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (templates.length === 0) {
                      toast.info("Nenhum template para exportar.");
                      return;
                    }
                    const exportable = templates.map(({ key, name, usage, mode, message }) => ({
                      key,
                      name,
                      ...(usage ? { usage } : {}),
                      mode,
                      message,
                    }));
                    const json = JSON.stringify(exportable, null, 2);
                    const blob = new Blob([json], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `templates-${agent.id.slice(0, 8)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success(`${templates.length} template(s) exportado(s).`);
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  <Download className="size-3.5" />
                  Exportar JSON
                </button>
              </div>
            </div>
            <MessageTemplatesSection templates={templates} onChange={setTemplates} />
            <ImportTemplatesModal
              open={importModalOpen}
              onClose={() => setImportModalOpen(false)}
              existingTemplates={templates}
              onApply={(next) => {
                setTemplates(next);
                setImportModalOpen(false);
              }}
            />
          </section>
        </CardContent>
      </Card>

      <div className="space-y-3 xl:sticky xl:top-28">
        {/* PR-AGENT-INTEGRATION-3: card "Quando ativado" so aparece em
            agentes secundarios (nao-principais). Cliente define
            conditions (tag/segment/mensagem/etapa/status) que ativam
            esse agente em vez do principal. Sem regras = nunca recebe
            leads.
            PR 33 (mai/2026): fica FORA dos accordions abaixo — é
            condicional (só não-principais) e é específico/crítico
            (decide se agente recebe leads ou não), então merece
            destaque próprio. */}
        {/* PR 33 (mai/2026): 6 cards soltos viraram 3 accordions
            agrupados por intenção. Reduz densidade visual ~70% e dá
            hierarquia (decisão > conversação > integrações). Cliente
            pode abrir múltiplos via openMultiple do base-ui. Default
            só "decide" aberto (Modelo + Transferir são os mais
            essenciais). */}
        {/* PR 35 (mai/2026): jump links — chips horizontais no topo
            pra navegar rápido entre accordions. Click expande +
            scrolla pra seção. Indicador dirty (bullet âmbar) no chip
            espelha o do header do accordion. */}
        <div className="flex flex-wrap gap-1.5">
          <JumpChip
            label="Decisões"
            dirty={decideDirty}
            onClick={() => jumpToAccordion("decide")}
          />
          <JumpChip
            label="Humanizacao"
            dirty={converseDirty}
            onClick={() => jumpToAccordion("converse")}
          />
          <JumpChip
            label="Integrações"
            dirty={integrationsDirty}
            onClick={() => jumpToAccordion("integrations")}
          />
          <JumpChip
            label="Validação"
            dirty={validationDirty}
            onClick={() => jumpToAccordion("validation")}
          />
        </div>

        <Accordion
          multiple
          value={openAccordions}
          onValueChange={setOpenAccordions}
          className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          {/* ────────────────────────────────────────────────────
              Grupo 1: Como o agente decide
              (Modelo + Transferir pra humano)
              ──────────────────────────────────────────────────── */}
          <AccordionItem value="decide" id="accordion-decide" className="border-b px-3 last:border-b-0">
            <AccordionTrigger className="py-3 text-sm">
              <span className="flex items-center gap-2">
                <Brain className="size-4 text-primary" />
                Como o agente decide
                {decideDirty ? <DirtyDot /> : null}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4 pt-1">
              <div className="space-y-1.5 rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="model">Modelo</Label>
                  <HelpTooltip>
                    <strong>GPT-5 mini</strong> é o padrão recomendado:
                    rápido, barato, qualidade boa pra atendimento típico.
                    Use <strong>GPT-5</strong> apenas se sentir que o
                    agente está errando muito em casos complexos.
                  </HelpTooltip>
                  {model === "gpt-5-mini" ? <DefaultBadge /> : null}
                </div>
                <Select
                  value={model}
                  onValueChange={(v) => v && setModel(v)}
                >
                  <SelectTrigger id="model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-5-mini">
                      GPT-5 mini (padrão)
                    </SelectItem>
                    <SelectItem value="gpt-4o-mini">GPT-4o mini</SelectItem>
                    <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                    <SelectItem value="gpt-5">GPT-5</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* PR-AGENT-INTEGRATION-1 (mai/2026): switch que libera
                  a IA usar `stop_agent` (transferir pra humano).
                  Notificação detalhada é configurada no Fluxo (Action
                  node trigger_notification) — não aqui. */}
              <div className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="flex-1 min-w-0">
                  <Label
                    htmlFor="allow_human_handoff"
                    className="cursor-pointer"
                  >
                    Permitir transferir pra humano
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Deixa o agente passar a conversa pra um atendente
                    quando detectar que está fora do escopo dele.
                  </p>
                </div>
                <Switch
                  id="allow_human_handoff"
                  checked={guardrails.allow_human_handoff}
                  onCheckedChange={(v) =>
                    setGuardrails((g) => ({
                      ...g,
                      allow_human_handoff: Boolean(v),
                    }))
                  }
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ────────────────────────────────────────────────────
              Grupo 2: Como o agente conversa
              (Pausa + Dividir + Horário comercial)
              ──────────────────────────────────────────────────── */}
          <AccordionItem
            value="converse"
            id="accordion-converse"
            className="border-b px-3 last:border-b-0"
          >
            <AccordionTrigger className="py-3 text-sm">
              <span className="flex items-center gap-2">
                <MessageSquare className="size-4 text-primary" />
                Atendimento humanizado
                {converseDirty ? <DirtyDot /> : null}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4 pt-1">
              <section className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
                <div>
                  <h4 className="text-sm font-semibold">
                    Receber mensagens como humano
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Controla como o agente escuta o lead antes de responder.
                    Enviar midia, mover kanban e adicionar tags ficam no Fluxo.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="debounce_window_seconds">
                        Unificar mensagens proximas
                      </Label>
                      <HelpTooltip>
                        Espera alguns segundos para juntar mensagens enviadas em
                        sequencia, como "oi" + "tenho uma duvida". Assim o
                        agente responde uma vez, com mais contexto.
                      </HelpTooltip>
                      {nextDebounceWindowMs === DEBOUNCE_WINDOW_MS_DEFAULT ? (
                        <DefaultBadge />
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {Math.round(nextDebounceWindowMs / 1000)}s
                    </span>
                  </div>
                  <PresetRail
                    items={DEBOUNCE_PRESETS.map((preset) => ({
                      label: preset.label,
                      active: nextDebounceWindowMs === preset.valueMs,
                      onClick: () =>
                        setDebounceWindowMs(
                          clampDebounceWindowMs(preset.valueMs),
                        ),
                    }))}
                  />
                  <Slider
                    id="debounce_window_seconds"
                    min={DEBOUNCE_WINDOW_MS_MIN / 1000}
                    max={DEBOUNCE_WINDOW_MS_MAX / 1000}
                    step={1}
                    value={[Math.round(nextDebounceWindowMs / 1000)]}
                    onValueChange={(value) =>
                      setDebounceWindowMs(
                        clampDebounceWindowMs(sliderValue(value, 0) * 1000),
                      )
                    }
                    aria-label="Unificar mensagens proximas"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>0s: responde na hora</span>
                    <span>{DEBOUNCE_WINDOW_MS_MAX / 1000}s: espera mais contexto</span>
                  </div>
                </div>

                <CapabilityRow
                  icon={<Image className="size-4" />}
                  title="Receber midia"
                  description="Fotos, audios, videos e documentos entram na conversa e no contexto. Envio de midia fica no Fluxo."
                />
              </section>
              {/* Subgrupo 2A — Pausa e ativação */}
              <section className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
                <div>
                  <h4 className="text-sm font-semibold">Pausa e ativação</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    O lead pode digitar palavras pra pausar ou reativar o
                    agente. Se um atendente humano responder pelo chat, o
                    agente também pausa automaticamente.
                  </p>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <Label
                      htmlFor="auto_pause_enabled"
                      className="cursor-pointer"
                    >
                      Auto-pausa quando humano responde
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Quando um atendente responde, o agente fica em silêncio
                      por um tempo. Próxima mensagem do lead reativa
                      automaticamente.
                    </p>
                  </div>
                  <Switch
                    id="auto_pause_enabled"
                    checked={humanizationEnabled}
                    onCheckedChange={(v) =>
                      setHumanizationEnabled(Boolean(v))
                    }
                  />
                </div>

                {humanizationEnabled ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="auto_pause_minutes">
                          Tempo de pausa após humano responder
                        </Label>
                        <HelpTooltip>
                          Tempo que a IA fica calada depois que um atendente
                          humano responde. <strong>30 minutos</strong> dá
                          espaço pro humano conduzir sem a IA "atropelar".
                          Máximo 24h (1440min).
                        </HelpTooltip>
                        {autoPauseMinutes === AUTO_PAUSE_MINUTES_DEFAULT ? (
                          <DefaultBadge />
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {autoPauseMinutes} min
                      </span>
                    </div>
                    <PresetRail
                      items={AUTO_PAUSE_PRESETS.map((preset) => ({
                        label: preset.label,
                        active: autoPauseMinutes === preset.value,
                        onClick: () =>
                          setAutoPauseMinutes(
                            clampAutoPauseMinutes(preset.value),
                          ),
                      }))}
                    />
                    <NumberStepper
                      id="auto_pause_minutes"
                      label="Tempo de pausa"
                      value={autoPauseMinutes}
                      min={1}
                      max={AUTO_PAUSE_MINUTES_MAX}
                      step={5}
                      suffix="min"
                      onChange={(value) =>
                        setAutoPauseMinutes(
                          clampAutoPauseMinutes(value),
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Tempo recomendado: 30 minutos. Máximo 1440 (24h).
                    </p>
                  </div>
                ) : null}

                <details className="group rounded-md border border-border/70 bg-background/70">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
                    Palavras de pausa e retorno
                    <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                      Avancado
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-border/60 p-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="pause_keywords">
                          Palavras pra pausar
                        </Label>
                        <HelpTooltip>
                          Quando o lead digita SOMENTE uma dessas palavras
                          (sem outras), a IA para. Útil pra quem quer pausar
                          mas esqueceu a palavra exata. Defaults cobrem o
                          básico ("pausar", "humano", "stop ia").
                        </HelpTooltip>
                        {arraysEqualIgnoreOrder(
                          nextPauseKeywords,
                          PAUSE_KEYWORDS_DEFAULT,
                        ) ? (
                          <DefaultBadge />
                        ) : null}
                      </div>
                      <Textarea
                        id="pause_keywords"
                        value={pauseKeywordsText}
                        onChange={(e) => setPauseKeywordsText(e.target.value)}
                        placeholder={PAUSE_KEYWORDS_DEFAULT.join("\n")}
                        rows={3}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Uma palavra por linha. Quando o lead digitar uma delas
                        (sem outras palavras), o agente para de responder. Não
                        diferencia maiúscula/minúscula.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="resume_keywords">
                          Palavras pra reativar
                        </Label>
                        <HelpTooltip>
                          Mesma lógica das palavras pra pausar, mas o oposto:
                          faz o agente voltar a responder. Defaults:
                          "ativar", "ia on", "voltar ia".
                        </HelpTooltip>
                        {arraysEqualIgnoreOrder(
                          nextResumeKeywords,
                          RESUME_KEYWORDS_DEFAULT,
                        ) ? (
                          <DefaultBadge />
                        ) : null}
                      </div>
                      <Textarea
                        id="resume_keywords"
                        value={resumeKeywordsText}
                        onChange={(e) => setResumeKeywordsText(e.target.value)}
                        placeholder={RESUME_KEYWORDS_DEFAULT.join("\n")}
                        rows={3}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Uma palavra por linha. Faz o agente voltar a responder
                        se estiver pausado.
                      </p>
                    </div>
                  </div>
                </details>
              </section>

              {/* Subgrupo 2B — Dividir respostas longas */}
              <section className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
                <div>
                  <h4 className="text-sm font-semibold">
                    Dividir respostas longas
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Quando o agente escrever uma resposta grande, divide
                    automaticamente em várias mensagens curtas no WhatsApp
                    — parece mais humano.
                  </p>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <Label htmlFor="split_enabled" className="cursor-pointer">
                      Ligar divisão de mensagens
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Respostas longas viram 2-3 mensagens curtas com pausa
                      entre elas. Respostas curtas continuam indo inteiras.
                    </p>
                  </div>
                  <Switch
                    id="split_enabled"
                    checked={splitEnabled}
                    onCheckedChange={(v) => setSplitEnabled(Boolean(v))}
                  />
                </div>

                {splitEnabled ? (
                  <>
                    <div className="space-y-1.5 pt-2 border-t border-border/60">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="split_threshold_chars">
                            Dividir quando a resposta passar de
                          </Label>
                          <HelpTooltip>
                            Respostas curtas (≤ esse valor) vão inteiras.
                            Acima disso, a IA quebra em 2-3 mensagens
                            menores com pausa entre elas. Padrão{" "}
                            {SPLIT_THRESHOLD_CHARS_DEFAULT} ≈ 3 linhas de
                            WhatsApp.
                          </HelpTooltip>
                          {splitThresholdChars ===
                          SPLIT_THRESHOLD_CHARS_DEFAULT ? (
                            <DefaultBadge />
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {splitThresholdChars} caracteres
                        </span>
                      </div>
                      <PresetRail
                        items={SPLIT_THRESHOLD_PRESETS.map((preset) => ({
                          label: preset.label,
                          active: splitThresholdChars === preset.value,
                          onClick: () =>
                            setSplitThresholdChars(
                              clampSplitThresholdChars(preset.value),
                            ),
                        }))}
                      />
                      <Slider
                        id="split_threshold_chars"
                        min={SPLIT_THRESHOLD_CHARS_MIN}
                        max={SPLIT_THRESHOLD_CHARS_MAX}
                        step={10}
                        value={[splitThresholdChars]}
                        onValueChange={(value) =>
                          setSplitThresholdChars(
                            clampSplitThresholdChars(
                              sliderValue(value, splitThresholdChars),
                            ),
                          )
                        }
                        aria-label="Dividir respostas longas"
                      />
                      <p className="text-xs text-muted-foreground">
                        Padrão: {SPLIT_THRESHOLD_CHARS_DEFAULT} caracteres
                        (~3 linhas). Valores entre {SPLIT_THRESHOLD_CHARS_MIN}
                        {" e "}
                        {SPLIT_THRESHOLD_CHARS_MAX}.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="split_delay_seconds">
                            Pausa entre mensagens
                          </Label>
                          <HelpTooltip>
                            Tempo simulando "digitando" entre cada mensagem
                            picotada. Padrão{" "}
                            {SPLIT_DELAY_SECONDS_DEFAULT}s — natural pro
                            ritmo de WhatsApp. Aumentar passa de "humano
                            digitando" pra "humano enrolando".
                          </HelpTooltip>
                          {splitDelaySeconds === SPLIT_DELAY_SECONDS_DEFAULT ? (
                            <DefaultBadge />
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {splitDelaySeconds}s
                        </span>
                      </div>
                      <NumberStepper
                        id="split_delay_seconds"
                        label="Pausa entre mensagens"
                        min={SPLIT_DELAY_SECONDS_MIN}
                        max={SPLIT_DELAY_SECONDS_MAX}
                        step={1}
                        value={splitDelaySeconds}
                        suffix="s"
                        onChange={(value) =>
                          setSplitDelaySeconds(
                            clampSplitDelaySeconds(value),
                          )
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Tempo de digitação simulado entre cada mensagem.
                        Padrão: {SPLIT_DELAY_SECONDS_DEFAULT}s.
                      </p>
                    </div>
                  </>
                ) : null}
              </section>

              {/* Subgrupo 2C — Horário comercial */}
              <section className="rounded-md border border-border/70 bg-muted/20 p-3">
                <BusinessHoursInline
                  enabled={businessHoursEnabled}
                  hours={businessHours}
                  afterHoursMessage={afterHoursMessage}
                  onEnabledChange={setBusinessHoursEnabled}
                  onHoursChange={setBusinessHours}
                  onAfterHoursMessageChange={setAfterHoursMessage}
                />
              </section>
            </AccordionContent>
          </AccordionItem>

          {/* ────────────────────────────────────────────────────
              Grupo 3: Integrações (Calendário)
              ──────────────────────────────────────────────────── */}
          {/* PR-AGENT-INTEGRATION-1: card de calendario reorganizado.
              Agenda interna (create_appointment via tools) ja funciona —
              agente agenda sem precisar de conexao externa. Google Calendar
              integration esta em desenvolvimento (handler schedule_event
              no enum mas sem TS handler). */}
          <AccordionItem
            value="integrations"
            id="accordion-integrations"
            className="border-b px-3 last:border-b-0"
          >
            <AccordionTrigger className="py-3 text-sm">
              <span className="flex items-center gap-2">
                <Plug className="size-4 text-primary" />
                Integrações
                {integrationsDirty ? <DirtyDot /> : null}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4 pt-1">
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <CalendarCheck className="size-4 text-primary" />
                  <h4 className="text-sm font-semibold">
                    Calendário do agente
                  </h4>
                </div>
                <Label htmlFor="calendar-connection" className="text-sm">
                  Onde o agente marca os compromissos
                </Label>
                <Select
                  value={calendarConnectionId ?? "_internal"}
                  onValueChange={(v) =>
                    setCalendarConnectionId(v && v !== "_internal" ? v : null)
                  }
                  disabled={isPending || calendarConnections === null}
                >
                  <SelectTrigger id="calendar-connection">
                    <SelectValue>
                      {calendarConnectionId === null
                        ? "Agenda do CRM (padrão)"
                        : calendarConnections?.find(
                            (c) => c.id === calendarConnectionId,
                          )?.display_name ?? "Carregando..."}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_internal">
                      Agenda do CRM (padrão)
                    </SelectItem>
                    {calendarConnections?.map((conn) => (
                      <SelectItem
                        key={conn.id}
                        value={conn.id}
                        disabled={conn.status !== "active"}
                      >
                        {conn.display_name}
                        {conn.status !== "active" ? (
                          <span className="text-muted-foreground">
                            {" "}
                            ({conn.status})
                          </span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {calendarConnectionId === null
                    ? "Compromissos vão direto na sua Agenda do CRM. Ative a ferramenta \"Agendar reunião\" no Fluxo pra liberar."
                    : "Compromissos vão pro Google Calendar conectado e aparecem também na sua Agenda do CRM."}
                </p>
                {calendarConnections && calendarConnections.length === 0 ? (
                  <Link
                    href="/settings/google-calendar"
                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline pt-1"
                  >
                    <ExternalLink className="size-3" />
                    Conectar Google Calendar
                  </Link>
                ) : null}
              </section>
            </AccordionContent>
          </AccordionItem>

          {/* ────────────────────────────────────────────────────
              Grupo 5: Validação antes do envio
              (Migration 101)
              ──────────────────────────────────────────────────── */}
          <AccordionItem value="validation" id="accordion-validation" className="px-3">
            <AccordionTrigger className="py-3 text-sm">
              <span className="flex items-center gap-2">
                <Shield className="size-4 text-primary" />
                Validação de resposta
                {validationDirty ? <DirtyDot /> : null}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pb-4 pt-1">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="validation-enabled" className="text-sm font-medium">
                    Ativar validação
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Verifica cada resposta antes de enviar. Agentes novos começam com validação desativada.
                  </p>
                </div>
                <Switch
                  id="validation-enabled"
                  checked={validationConfig.enabled}
                  onCheckedChange={(v) =>
                    setValidationConfig((prev) => ({ ...prev, enabled: v }))
                  }
                />
              </div>

              {validationConfig.enabled ? (
                <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                  {/* max_chars */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="validation-max-chars" className="text-sm">
                        Tamanho máximo (caracteres)
                      </Label>
                      <HelpTooltip>
                        0 = sem limite. Respostas maiores que este valor serão bloqueadas.
                      </HelpTooltip>
                    </div>
                    <Input
                      id="validation-max-chars"
                      type="number"
                      min={0}
                      value={validationConfig.max_chars}
                      onChange={(e) =>
                        setValidationConfig((prev) => ({
                          ...prev,
                          max_chars: Math.max(0, parseInt(e.target.value) || 0),
                        }))
                      }
                    />
                  </div>

                  {/* one_question_only */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Máximo de 1 pergunta por resposta</Label>
                      <p className="text-xs text-muted-foreground">
                        Bloqueia respostas com mais de um "?".
                      </p>
                    </div>
                    <Switch
                      checked={validationConfig.one_question_only}
                      onCheckedChange={(v) =>
                        setValidationConfig((prev) => ({ ...prev, one_question_only: v }))
                      }
                    />
                  </div>

                  {/* block_empty_response */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Bloquear resposta vazia</Label>
                      <p className="text-xs text-muted-foreground">
                        Impede envio quando a IA gera texto em branco.
                      </p>
                    </div>
                    <Switch
                      checked={validationConfig.block_empty_response}
                      onCheckedChange={(v) =>
                        setValidationConfig((prev) => ({ ...prev, block_empty_response: v }))
                      }
                    />
                  </div>

                  {/* forbidden_phrases */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="validation-forbidden" className="text-sm">
                        Frases proibidas
                      </Label>
                      <HelpTooltip>
                        Uma frase por linha. Respostas que contiverem qualquer frase serão bloqueadas (ignora maiúsculas/minúsculas).
                      </HelpTooltip>
                    </div>
                    <Textarea
                      id="validation-forbidden"
                      rows={3}
                      placeholder={"preço negociável\npagamento parcelado"}
                      value={validationConfig.forbidden_phrases.join("\n")}
                      onChange={(e) =>
                        setValidationConfig((prev) => ({
                          ...prev,
                          forbidden_phrases: e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                  </div>

                  {/* blocked_promises */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="validation-promises" className="text-sm">
                        Promessas bloqueadas
                      </Label>
                      <HelpTooltip>
                        Expressões que a IA não pode prometer ao lead (ex: "garantia", "desconto especial").
                      </HelpTooltip>
                    </div>
                    <Textarea
                      id="validation-promises"
                      rows={3}
                      placeholder={"garantia total\ndesconto especial"}
                      value={validationConfig.blocked_promises.join("\n")}
                      onChange={(e) =>
                        setValidationConfig((prev) => ({
                          ...prev,
                          blocked_promises: e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                  </div>

                  {/* on_block */}
                  <div className="space-y-1.5">
                    <Label htmlFor="validation-on-block" className="text-sm">
                      Ação ao bloquear
                    </Label>
                    <Select
                      value={validationConfig.on_block}
                      onValueChange={(v) =>
                        setValidationConfig((prev) => ({
                          ...prev,
                          on_block: v as ValidationConfig["on_block"],
                        }))
                      }
                    >
                      <SelectTrigger id="validation-on-block">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rewrite">Reescrever com IA</SelectItem>
                        <SelectItem value="fallback">Usar mensagem de reserva</SelectItem>
                        <SelectItem value="pause_ai">Pausar agente</SelectItem>
                        <SelectItem value="alert_only">Só registrar (envia mesmo assim)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* fallback_message */}
                  {(validationConfig.on_block === "fallback" ||
                    validationConfig.on_block === "rewrite") ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="validation-fallback" className="text-sm">
                          Mensagem de reserva
                        </Label>
                        <HelpTooltip>
                          {validationConfig.on_block === "rewrite"
                            ? "Usada se a reescrita também falhar na validação."
                            : "Enviada no lugar da resposta bloqueada."}
                        </HelpTooltip>
                      </div>
                      <Textarea
                        id="validation-fallback"
                        rows={2}
                        placeholder="Ex: Deixa eu verificar isso contigo em um momento."
                        value={validationConfig.fallback_message}
                        onChange={(e) =>
                          setValidationConfig((prev) => ({
                            ...prev,
                            fallback_message: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

      </div>
    </div>

    {/* ────────────────────────────────────────────────────────
        PR 34 (mai/2026): Sticky save bar — botão Salvar +
        indicador "alterações não salvas" fixos no rodapé do
        RulesTab. Cliente pode salvar de qualquer scroll position
        sem precisar rolar até o final dos accordions.
        z-20 < z-40 do FAB Tester → FAB sobrepõe canto direito
        da bar (esperado, FAB é menor).
        ──────────────────────────────────────────────────────── */}
    </div>
    </TooltipProvider>
  );
}

// ============================================================================
// PR 37 (mai/2026): helper de comparação pra DefaultBadge dos keywords
// ============================================================================
//
// Compara dois arrays string ignorando ordem (já sanitizados). Útil pra
// detectar se as palavras-chave estão no estado default — mesmo que o
// cliente tenha reordenado, se o conteúdo é idêntico, mostra "padrão".
function arraysEqualIgnoreOrder(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

function sliderValue(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? value[0] ?? fallback : value;
}

// ============================================================================
// PR 35 (mai/2026): helpers do dirty marker + jump links
// ============================================================================

// Bullet pequeno cor progress que aparece no header dos accordions
// (e nos chips de jump link) quando há mudança não salva na seção.
// Cor progress (laranja/âmbar) é a mesma do "Alterações não salvas"
// no sticky save bar — consistência visual.
function DirtyDot() {
  return (
    <span
      className="size-2 rounded-full bg-progress inline-block ml-1"
      aria-label="Alterações não salvas"
      title="Alterações não salvas"
    />
  );
}

// PR 36 (mai/2026): ícone `?` ao lado de campos técnicos que cliente
// leigo pode não entender ("o que é GPT-5-mini?", "30 minutos é
// muito ou pouco?"). Tooltip mostra explicação curta no hover.
// Reusa Tooltip do design system (base-ui).
function HelpTooltip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Ajuda"
      >
        <HelpCircle className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

// PR 36 (mai/2026): badge pequeno "padrão" mostrado quando o valor
// do campo é igual ao default recomendado. Cliente percebe
// visualmente que NÃO precisa mexer naquilo — reduz ansiedade de
// configurar todos os campos. Some quando o cliente altera.
function DefaultBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      padrão
    </span>
  );
}

// Chip clicável no topo da coluna direita — atalho pra rolar (+ abrir)
// um accordion específico. Mostra bullet âmbar quando a seção tem
// dirty fields, igual o header do próprio accordion.
function PresetRail({
  items,
}: {
  items: Array<{ label: string; active: boolean; onClick: () => void }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={item.onClick}
          className={`inline-flex min-h-8 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition-colors ${
            item.active
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          aria-pressed={item.active}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function NumberStepper({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const clamp = (next: number) =>
    Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : value;

  return (
    <div className="flex max-w-44 items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => onChange(clamp(value - step))}
        aria-label={`Diminuir ${label}`}
      >
        <Minus className="size-3.5" />
      </Button>
      <div className="relative w-24">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="h-8 pr-12 text-center tabular-nums"
          aria-label={label}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => onChange(clamp(value + step))}
        aria-label={`Aumentar ${label}`}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

function CapabilityRow({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/25 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-medium uppercase text-success">
              <CheckCircle2 className="size-3" />
              ativo
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

function JumpChip({
  label,
  dirty,
  onClick,
}: {
  label: string;
  dirty: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        dirty
          ? "border-progress/40 bg-progress/10 text-progress hover:bg-progress/20"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
      {dirty ? <DirtyDot /> : null}
    </button>
  );
}

// PR-AI-AGENT-HUMAN-C: card de horario comercial. 7 toggles dia-da-semana
// + 2 inputs time (start/end) por dia aberto + textarea fora-do-horario.
// Timezone fica hardcoded "America/Sao_Paulo" pra cliente brasileiro —
// admin edita JSONB via SQL se precisar mudar.
const DAY_LABELS: Record<DayName, string> = {
  monday: "Segunda",
  tuesday: "Terça",
  wednesday: "Quarta",
  thursday: "Quinta",
  friday: "Sexta",
  saturday: "Sábado",
  sunday: "Domingo",
};

interface BusinessHoursInlineProps {
  enabled: boolean;
  hours: BusinessHours;
  afterHoursMessage: string;
  onEnabledChange: (v: boolean) => void;
  onHoursChange: (next: BusinessHours) => void;
  onAfterHoursMessageChange: (next: string) => void;
}

// PR 33 (mai/2026): renomeado de BusinessHoursCard pra ...Inline.
// Antes era um <Card> com CardHeader/CardContent — virou subgrupo
// inline dentro de accordion "Como o agente conversa". Conteúdo
// idêntico; só dropei o wrapper Card pra evitar nested cards.
function BusinessHoursInline({
  enabled,
  hours,
  afterHoursMessage,
  onEnabledChange,
  onHoursChange,
  onAfterHoursMessageChange,
}: BusinessHoursInlineProps) {
  const setDayOpen = (day: DayName, open: boolean) => {
    onHoursChange({
      ...hours,
      [day]: open
        ? hours[day] ?? BUSINESS_HOURS_DEFAULT[day] ?? { start: "09:00", end: "18:00" }
        : null,
    });
  };
  const setDayField = (day: DayName, field: keyof DayHours, value: string) => {
    const current = hours[day];
    if (!current) return;
    onHoursChange({ ...hours, [day]: { ...current, [field]: value } });
  };
  const messageTooLong =
    afterHoursMessage.length > AFTER_HOURS_MESSAGE_MAX_LENGTH;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">Horário comercial</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Limita os horários que o agente responde. Fora do horário, manda
          uma mensagem padrão e deixa a conversa pra você responder depois.
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="business_hours_enabled"
                className="cursor-pointer"
              >
                Respeitar horário comercial
              </Label>
              <HelpTooltip>
                Quando ligado, a IA só responde nos dias/horários
                marcados abaixo. Fora disso manda a mensagem padrão
                (1x por janela de 6h) e deixa o lead aguardando humano.
                Fuso fixo: América/São Paulo.
              </HelpTooltip>
              {!enabled ? <DefaultBadge /> : null}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Quando desligado, o agente responde 24/7. Fuso fixo:
              América/São Paulo.
            </p>
          </div>
          <Switch
            id="business_hours_enabled"
            checked={enabled}
            onCheckedChange={(v) => onEnabledChange(Boolean(v))}
          />
        </div>

        {enabled ? (
          <>
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-xs">Dias e horários</Label>
              <div className="space-y-1.5">
                {DAY_NAMES.map((day) => {
                  const dayHours = hours[day];
                  const isOpen = dayHours !== null;
                  return (
                    <div
                      key={day}
                      className="flex items-center gap-2 text-xs"
                    >
                      <label className="flex items-center gap-2 w-24 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isOpen}
                          onChange={(e) => setDayOpen(day, e.target.checked)}
                          className="accent-primary"
                        />
                        <span className="font-medium">
                          {DAY_LABELS[day]}
                        </span>
                      </label>
                      {isOpen && dayHours ? (
                        <>
                          <Input
                            type="time"
                            value={dayHours.start}
                            onChange={(e) =>
                              setDayField(day, "start", e.target.value)
                            }
                            className="h-8 w-28 text-xs"
                            aria-label={`${DAY_LABELS[day]} — início`}
                          />
                          <span className="text-muted-foreground">até</span>
                          <Input
                            type="time"
                            value={dayHours.end}
                            onChange={(e) =>
                              setDayField(day, "end", e.target.value)
                            }
                            className="h-8 w-28 text-xs"
                            aria-label={`${DAY_LABELS[day]} — fim`}
                          />
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">
                          Fechado
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="after_hours_message">
                    Mensagem fora do horário
                  </Label>
                  <HelpTooltip>
                    Enviada UMA vez por janela de 6h pra evitar spammar
                    leads que mandam várias mensagens fora do horário. Use
                    pra setar expectativa ("Voltamos às 8h").
                  </HelpTooltip>
                  {afterHoursMessage.trim() === AFTER_HOURS_MESSAGE_DEFAULT ? (
                    <DefaultBadge />
                  ) : null}
                </div>
                <span
                  className={`text-xs tabular-nums ${
                    messageTooLong ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {afterHoursMessage.length}/{AFTER_HOURS_MESSAGE_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="after_hours_message"
                value={afterHoursMessage}
                onChange={(e) => onAfterHoursMessageChange(e.target.value)}
                placeholder={AFTER_HOURS_MESSAGE_DEFAULT}
                rows={3}
                aria-invalid={messageTooLong}
                className={messageTooLong ? "border-destructive" : undefined}
              />
              <p className="text-xs text-muted-foreground">
                Enviada uma única vez por janela de 6 horas pra evitar spammar
                leads que mandam várias mensagens fora do horário.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Templates de mensagem ───────────────────────────────────────────────────
// CRUD inline: lista de cards com campos key/name/usage/mode/message.
// key: slug único usado pelo Fluxo pra referenciar o template.
// mode ai_suggestion: injetado no system prompt do node IA como bloco
//   de referência — IA adapta conforme contexto.
// mode fixed_response: enviado literal pelo action node send_template_message
//   sem chamar IA. Suporta {{nome}}, {{telefone}} etc.

const TEMPLATE_MODE_LABELS: Record<MessageTemplate["mode"], string> = {
  ai_suggestion: "Sugestão para IA",
  fixed_response: "Resposta fixa",
};

const TEMPLATE_MODE_DESCRIPTIONS: Record<MessageTemplate["mode"], string> = {
  ai_suggestion: "Injetado no prompt do node IA — a IA pode adaptar conforme o contexto.",
  fixed_response: "Enviado exatamente como está, sem chamar a IA.",
};

/**
 * Converte um nome em slug: minúsculas, sem acentos, underline em vez de espaços.
 * Ex: "Perguntar nome" → "perguntar_nome"
 */
function nameToSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_\s]/g, "")
    .replace(/\s+/g, "_");
}

/**
 * Garante slug único dentro da lista. Se já existir, adiciona _2, _3 etc.
 */
function uniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// ============================================================================
// ImportTemplatesModal
// ============================================================================

type ImportMode = "merge" | "replace";

interface ParsedTemplate {
  key: string;
  name: string;
  usage?: string;
  mode: "ai_suggestion" | "fixed_response";
  message: string;
}

interface ParseResult {
  ok: true;
  items: ParsedTemplate[];
  errors: string[];
}

interface ParseError {
  ok: false;
  errors: string[];
}

function parseTemplateJson(raw: string): ParseResult | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["JSON inválido. Verifique a sintaxe e tente novamente."] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, errors: ["O JSON deve ser um array ([ ... ])."] };
  }
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  const items: ParsedTemplate[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as Record<string, unknown>;
    const label = `Item ${i + 1}`;
    if (!raw.key || typeof raw.key !== "string" || !raw.key.trim()) {
      errors.push(`${label}: campo "key" obrigatório.`);
      continue;
    }
    const key = String(raw.key).trim();
    if (/\s/.test(key)) {
      errors.push(`${label}: chave "${key}" contém espaços.`);
    }
    if (!/^[a-z0-9_]+$/i.test(key)) {
      errors.push(`${label}: chave "${key}" contém caracteres inválidos (use letras, números e _).`);
    }
    if (seenKeys.has(key)) {
      errors.push(`Chave duplicada no arquivo: "${key}".`);
    }
    seenKeys.add(key);
    if (!raw.name || typeof raw.name !== "string" || !raw.name.trim()) {
      errors.push(`${label}: campo "name" obrigatório.`);
    }
    if (!raw.message || typeof raw.message !== "string" || !raw.message.trim()) {
      errors.push(`${label}: campo "message" obrigatório.`);
    }
    const mode = raw.mode as string | undefined;
    if (mode !== undefined && mode !== "ai_suggestion" && mode !== "fixed_response") {
      errors.push(`${label}: mode inválido "${mode}". Use "ai_suggestion" ou "fixed_response".`);
    }
    if (errors.length === 0 || !errors.some((e) => e.startsWith(label))) {
      items.push({
        key,
        name: String(raw.name ?? "").trim(),
        ...(raw.usage ? { usage: String(raw.usage).trim() } : {}),
        mode: (mode as "ai_suggestion" | "fixed_response") ?? "ai_suggestion",
        message: String(raw.message ?? "").trim(),
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, items, errors: [] };
}

const EXAMPLE_JSON = `[
  {
    "key": "ask_name",
    "name": "Perguntar nome",
    "usage": "Use quando precisar perguntar o nome do lead.",
    "mode": "ai_suggestion",
    "message": "Qual é o seu nome?"
  },
  {
    "key": "fallback",
    "name": "Fallback padrão",
    "usage": "Use quando a conversa sair do escopo.",
    "mode": "fixed_response",
    "message": "Certo, já já damos continuidade por aqui."
  }
]`;

function ImportTemplatesModal({
  open,
  onClose,
  existingTemplates,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  existingTemplates: MessageTemplate[];
  onApply: (next: MessageTemplate[]) => void;
}) {
  const [raw, setRaw] = React.useState("");
  const [mode, setMode] = React.useState<ImportMode>("merge");
  const [showExample, setShowExample] = React.useState(false);
  const [result, setResult] = React.useState<ParseResult | ParseError | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      setRaw("");
      setResult(null);
      setShowExample(false);
    }
  }, [open]);

  const handleValidate = () => {
    setResult(parseTemplateJson(raw.trim()));
  };

  const handleApply = () => {
    if (!result?.ok) return;
    const imported = result.items as MessageTemplate[];
    let next: MessageTemplate[];
    if (mode === "replace") {
      next = imported;
    } else {
      const existing = [...existingTemplates];
      for (const tpl of imported) {
        const idx = existing.findIndex((e) => e.key === tpl.key);
        if (idx >= 0) {
          existing[idx] = { ...existing[idx], ...tpl };
        } else {
          existing.push(tpl);
        }
      }
      next = existing;
    }
    onApply(next);
    toast.success(
      mode === "replace"
        ? `${imported.length} template(s) importado(s) (substituição total).`
        : `${imported.length} template(s) importado(s) (adição/atualização).`
    );
  };

  // Preview counts (only when parse is OK)
  let previewNew = 0;
  let previewUpdated = 0;
  if (result?.ok) {
    for (const tpl of result.items) {
      if (existingTemplates.some((e) => e.key === tpl.key)) {
        previewUpdated++;
      } else {
        previewNew++;
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar templates por JSON</DialogTitle>
          <DialogDescription>
            Cole um JSON com vários templates para criar ou atualizar mensagens em lote.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode selector */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Modo de importação</Label>
            <Select
              value={mode}
              onValueChange={(v) => v && setMode(v as ImportMode)}
            >
              <SelectTrigger data-size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="merge">Adicionar / atualizar por chave</SelectItem>
                <SelectItem value="replace">Substituir todos os templates</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Example toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowExample((v) => !v)}
              className="text-xs text-primary underline underline-offset-2"
            >
              {showExample ? "Ocultar exemplo" : "Ver exemplo de JSON"}
            </button>
            {showExample ? (
              <pre className="mt-2 rounded-md bg-muted/60 p-3 text-[11px] leading-relaxed overflow-auto max-h-40 border border-border">
                {EXAMPLE_JSON}
              </pre>
            ) : null}
          </div>

          {/* JSON textarea */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">JSON</Label>
            <Textarea
              rows={8}
              placeholder="Cole o JSON aqui…"
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setResult(null); }}
              className="font-mono text-xs"
            />
          </div>

          {/* File upload */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  setRaw(String(ev.target?.result ?? ""));
                  setResult(null);
                };
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs text-primary underline underline-offset-2"
            >
              Ou carregar arquivo .json
            </button>
          </div>

          {/* Errors */}
          {result && !result.ok ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
              <p className="text-xs font-semibold text-destructive">Erros encontrados:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-xs text-destructive">{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Preview */}
          {result?.ok ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-semibold">{result.items.length} template(s) encontrado(s)</p>
              {mode === "merge" ? (
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  <li>{previewNew} novo(s)</li>
                  <li>{previewUpdated} atualizado(s)</li>
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Todos os templates atuais serão substituídos por {result.items.length} template(s).
                </p>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          {!result?.ok ? (
            <Button size="sm" onClick={handleValidate} disabled={!raw.trim()}>
              Validar JSON
            </Button>
          ) : (
            <Button size="sm" onClick={handleApply}>
              Importar templates
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageTemplatesSection({
  templates,
  onChange,
}: {
  templates: MessageTemplate[];
  onChange: React.Dispatch<React.SetStateAction<MessageTemplate[]>>;
}) {
  const nameInputRefs = React.useRef<Map<string, HTMLInputElement>>(new Map());

  const handleNew = () => {
    const tempKey = `tpl_new_${Date.now()}`;
    onChange((prev) => [
      ...prev,
      { key: tempKey, name: "", mode: "ai_suggestion", message: "" },
    ]);
    // Foco automático após render
    setTimeout(() => {
      nameInputRefs.current.get(tempKey)?.focus();
    }, 50);
  };

  if (templates.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
        Nenhum template criado. Clique em "Novo template" para começar.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {templates.map((tpl, idx) => (
        <MessageTemplateCard
          key={tpl.key}
          tpl={tpl}
          allKeys={templates.map((t) => t.key).filter((k) => k !== tpl.key)}
          nameInputRef={(el) => {
            if (el) nameInputRefs.current.set(tpl.key, el);
            else nameInputRefs.current.delete(tpl.key);
          }}
          onUpdate={(patch) =>
            onChange((prev) =>
              prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
            )
          }
          onDelete={() =>
            onChange((prev) => prev.filter((_, i) => i !== idx))
          }
          usedInNodes={[]} // sem verificação de nodes por enquanto
        />
      ))}
    </div>
  );
}

// Botão "Novo template" movido para dentro da section no JSX principal (usa handleNew)
// — mas a section acima é usada diretamente. O botão já existe no JSX pai (handleSave).

function MessageTemplateCard({
  tpl,
  allKeys,
  nameInputRef,
  onUpdate,
  onDelete,
  usedInNodes,
}: {
  tpl: MessageTemplate;
  allKeys: string[];
  nameInputRef: (el: HTMLInputElement | null) => void;
  onUpdate: (patch: Partial<MessageTemplate>) => void;
  onDelete: () => void;
  usedInNodes: string[];
}) {
  const [expanded, setExpanded] = React.useState(tpl.name === "" || tpl.key.startsWith("tpl_new_"));
  const [pendingDelete, setPendingDelete] = React.useState(false);

  const displayName = tpl.name.trim() || "Novo template";
  const slugDuplicate = allKeys.includes(tpl.key);
  const hasSpaceInKey = /\s/.test(tpl.key);
  const keyErrors = [
    slugDuplicate && "Chave duplicada — use um nome diferente",
    hasSpaceInKey && "A chave não pode ter espaços",
  ].filter(Boolean) as string[];

  const handleNameChange = (name: string) => {
    const slug = nameToSlug(name);
    const newKey = slug
      ? uniqueSlug(slug, allKeys)
      : tpl.key.startsWith("tpl_new_") ? "" : tpl.key;
    onUpdate({ name, key: newKey });
  };

  const handleDelete = () => {
    if (usedInNodes.length > 0) {
      setPendingDelete(true);
    } else {
      onDelete();
    }
  };

  return (
    <div className={`rounded-md border bg-card shadow-sm ${slugDuplicate ? "border-destructive/50" : "border-border"}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles className="size-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayName}</p>
          {tpl.key && !tpl.key.startsWith("tpl_new_") ? (
            <p className="truncate text-[10px] text-muted-foreground">
              Chave: {tpl.key} • {TEMPLATE_MODE_LABELS[tpl.mode]}
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            tpl.mode === "fixed_response"
              ? "bg-amber-500/15 text-amber-600"
              : "bg-primary/10 text-primary"
          }`}
        >
          {TEMPLATE_MODE_LABELS[tpl.mode]}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 rounded p-1 hover:bg-muted transition-colors"
          aria-label={expanded ? "Recolher" : "Expandir"}
        >
          <Pencil className="size-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="shrink-0 rounded p-1 hover:bg-destructive/10 transition-colors"
          aria-label="Remover template"
        >
          <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      </div>

      {/* Confirmação de exclusão quando usado em nodes */}
      {pendingDelete ? (
        <div className="border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs space-y-2">
          <p className="text-destructive font-medium">
            Este template está sendo usado em {usedInNodes.length} node(s). Se excluir, esses nodes perderão a referência.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-destructive px-2 py-1 text-xs text-white hover:bg-destructive/80"
            >
              Excluir mesmo assim
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(false)}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {/* Expanded form */}
      {expanded ? (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome do template *</Label>
              <Input
                ref={nameInputRef}
                value={tpl.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Ex: Perguntar nome"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chave do template *</Label>
              <Input
                value={tpl.key.startsWith("tpl_new_") ? "" : tpl.key}
                onChange={(e) =>
                  onUpdate({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").replace(/\s+/g, "_") })
                }
                placeholder="Ex: perguntar_nome"
                className={`h-8 font-mono text-sm ${keyErrors.length > 0 ? "border-destructive" : ""}`}
              />
              {keyErrors.length > 0 ? (
                <p className="text-[10px] text-destructive">{keyErrors[0]}</p>
              ) : (
                <p className="text-[10px] text-muted-foreground">Usada nos nodes do fluxo para referenciar este template.</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Modo de uso</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["ai_suggestion", "fixed_response"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onUpdate({ mode })}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    tpl.mode === mode
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-muted/30 hover:bg-muted/60"
                  }`}
                >
                  <p className="text-xs font-medium">{TEMPLATE_MODE_LABELS[mode]}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                    {TEMPLATE_MODE_DESCRIPTIONS[mode]}
                  </p>
                </button>
              ))}
            </div>
            {tpl.mode === "fixed_response" ? (
              <p className="rounded-md bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning-soft-foreground mt-1">
                Esta mensagem será enviada exatamente como está, sem passar pela IA.
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Quando usar{" "}
              <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              value={tpl.usage ?? ""}
              onChange={(e) => onUpdate({ usage: e.target.value || undefined })}
              placeholder="Ex: Use quando o agente precisar perguntar o nome do lead."
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Mensagem *{" "}
              {tpl.mode === "fixed_response" && (
                <span className="text-muted-foreground">
                  — suporta {"{{nome}}"}, {"{{telefone}}"} etc.
                </span>
              )}
            </Label>
            <textarea
              value={tpl.message}
              onChange={(e) => onUpdate({ message: e.target.value })}
              placeholder={
                tpl.mode === "fixed_response"
                  ? "Texto exato que será enviado ao cliente, sem alterações..."
                  : "Texto de referência que a IA pode adaptar ao contexto..."
              }
              rows={4}
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none ${
                !tpl.message.trim() ? "border-input" : "border-input"
              }`}
            />
            {!tpl.message.trim() ? (
              <p className="text-[10px] text-muted-foreground">Campo obrigatório.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
