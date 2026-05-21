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
  ExternalLink,
  MessageSquare,
  Plug,
  Save,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type {
  AgentCalendarConnectionPublic,
  AgentConfig,
  AgentGuardrails,
  AgentTool,
  UpdateAgentInput,
} from "@persia/shared/ai-agent";
import {
  AFTER_HOURS_MESSAGE_DEFAULT,
  AFTER_HOURS_MESSAGE_MAX_LENGTH,
  AUTO_PAUSE_MINUTES_DEFAULT,
  AUTO_PAUSE_MINUTES_MAX,
  BUSINESS_HOURS_DEFAULT,
  DAY_NAMES,
  PAUSE_KEYWORDS_DEFAULT,
  RESUME_KEYWORDS_DEFAULT,
  SPLIT_DELAY_SECONDS_DEFAULT,
  SPLIT_DELAY_SECONDS_MAX,
  SPLIT_DELAY_SECONDS_MIN,
  SPLIT_THRESHOLD_CHARS_DEFAULT,
  SPLIT_THRESHOLD_CHARS_MAX,
  SPLIT_THRESHOLD_CHARS_MIN,
  clampAutoPauseMinutes,
  clampSplitDelaySeconds,
  clampSplitThresholdChars,
  normalizeHumanizationConfig,
  sanitizeBusinessHours,
  sanitizeKeywordList,
  type BusinessHours,
  type DayHours,
  type DayName,
} from "@persia/shared/ai-agent";
import { EntryConditionsCard } from "./EntryConditionsCard";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";

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
}

export function RulesTab({
  agent,
  onChange,
  isPending,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tools: _tools,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onToolsChange: _onToolsChange,
}: Props) {
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

  const { listCalendarConnections } = useAgentActions();

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
  }, [
    agent.id,
    agent.system_prompt,
    agent.description,
    agent.model,
    agent.guardrails,
    agent.calendar_connection_id,
  ]);

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

  const dirty =
    promptDirty ||
    descriptionDirty ||
    modelDirty ||
    guardrailsDirty ||
    calendarConnectionDirty ||
    humanizationDirty;

  // PR 27 (mai/2026): auto-save do PR 26 foi revertido. Cliente
  // preferiu fluxo manual com botão "Salvar alterações" — feedback
  // mais previsível ("eu sei quando salva"). Pra mitigar o risco
  // de perder mudanças, useUnsavedChangesGuard abaixo avisa quando
  // tenta sair com `dirty=true`.
  const handleSave = React.useCallback(() => {
    const patch: UpdateAgentInput = {};
    if (promptDirty) patch.system_prompt = prompt;
    if (descriptionDirty) patch.description = description;
    if (modelDirty) patch.model = model;
    if (guardrailsDirty) patch.guardrails = guardrails;
    if (calendarConnectionDirty) {
      patch.calendar_connection_id = calendarConnectionId;
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
    onChange(patch, "Configurações salvas");
  }, [
    promptDirty,
    descriptionDirty,
    modelDirty,
    guardrailsDirty,
    calendarConnectionDirty,
    humanizationDirty,
    prompt,
    description,
    model,
    guardrails,
    calendarConnectionId,
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
    onChange,
  ]);

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
      {/* PR 27 (mai/2026): guard pra "este projeto não foi salvo,
          deseja sair?" Combina beforeunload nativo (fechar aba/reload)
          + intercept de Link clicks (navegação interna Next.js).
          Renderiza AlertDialog customizado quando user clica em link
          interno com dirty=true. */}
      <UnsavedChangesGuard dirty={dirty} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instruções do agente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Qual o papel desse agente?"
              rows={2}
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
        </CardContent>
      </Card>

      <div className="space-y-4">
        {/* PR-AGENT-INTEGRATION-3: card "Quando ativado" so aparece em
            agentes secundarios (nao-principais). Cliente define
            conditions (tag/segment/mensagem/etapa/status) que ativam
            esse agente em vez do principal. Sem regras = nunca recebe
            leads.
            PR 33 (mai/2026): fica FORA dos accordions abaixo — é
            condicional (só não-principais) e é específico/crítico
            (decide se agente recebe leads ou não), então merece
            destaque próprio. */}
        {agent.is_primary === false ? (
          <EntryConditionsCard configId={agent.id} />
        ) : null}

        {/* PR 33 (mai/2026): 6 cards soltos viraram 3 accordions
            agrupados por intenção. Reduz densidade visual ~70% e dá
            hierarquia (decisão > conversação > integrações). Cliente
            pode abrir múltiplos via openMultiple do base-ui. Default
            só "decide" aberto (Modelo + Transferir são os mais
            essenciais). */}
        <Accordion
          multiple
          defaultValue={["decide"]}
          className="rounded-xl border border-border bg-card divide-y divide-border"
        >
          {/* ────────────────────────────────────────────────────
              Grupo 1: Como o agente decide
              (Modelo + Transferir pra humano)
              ──────────────────────────────────────────────────── */}
          <AccordionItem value="decide" className="px-4">
            <AccordionTrigger className="text-base">
              <span className="flex items-center gap-2">
                <Brain className="size-4 text-primary" />
                Como o agente decide
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="model">Modelo</Label>
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
              <div className="flex items-start justify-between gap-3 pt-2 border-t border-border/60">
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
          <AccordionItem value="converse" className="px-4">
            <AccordionTrigger className="text-base">
              <span className="flex items-center gap-2">
                <MessageSquare className="size-4 text-primary" />
                Como o agente conversa
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              {/* Subgrupo 2A — Pausa e ativação */}
              <section className="space-y-4">
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
                      <Label htmlFor="auto_pause_minutes">
                        Tempo de pausa após humano responder
                      </Label>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {autoPauseMinutes} min
                      </span>
                    </div>
                    <Input
                      id="auto_pause_minutes"
                      type="number"
                      min={1}
                      max={AUTO_PAUSE_MINUTES_MAX}
                      step={5}
                      value={autoPauseMinutes}
                      onChange={(e) =>
                        setAutoPauseMinutes(
                          clampAutoPauseMinutes(Number(e.target.value)),
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Tempo recomendado: 30 minutos. Máximo 1440 (24h).
                    </p>
                  </div>
                ) : null}

                <div className="space-y-1.5 pt-2 border-t border-border/60">
                  <Label htmlFor="pause_keywords">Palavras pra pausar</Label>
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
                  <Label htmlFor="resume_keywords">Palavras pra reativar</Label>
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
              </section>

              {/* Subgrupo 2B — Dividir respostas longas */}
              <section className="space-y-4 pt-4 border-t border-border">
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
                        <Label htmlFor="split_threshold_chars">
                          Dividir quando a resposta passar de
                        </Label>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {splitThresholdChars} caracteres
                        </span>
                      </div>
                      <Input
                        id="split_threshold_chars"
                        type="number"
                        min={SPLIT_THRESHOLD_CHARS_MIN}
                        max={SPLIT_THRESHOLD_CHARS_MAX}
                        step={10}
                        value={splitThresholdChars}
                        onChange={(e) =>
                          setSplitThresholdChars(
                            clampSplitThresholdChars(Number(e.target.value)),
                          )
                        }
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
                        <Label htmlFor="split_delay_seconds">
                          Pausa entre mensagens
                        </Label>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {splitDelaySeconds}s
                        </span>
                      </div>
                      <Input
                        id="split_delay_seconds"
                        type="number"
                        min={SPLIT_DELAY_SECONDS_MIN}
                        max={SPLIT_DELAY_SECONDS_MAX}
                        step={1}
                        value={splitDelaySeconds}
                        onChange={(e) =>
                          setSplitDelaySeconds(
                            clampSplitDelaySeconds(Number(e.target.value)),
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
              <section className="pt-4 border-t border-border">
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
          <AccordionItem value="integrations" className="px-4">
            <AccordionTrigger className="text-base">
              <span className="flex items-center gap-2">
                <Plug className="size-4 text-primary" />
                Integrações
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
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
        </Accordion>

        {/* PR 27 (mai/2026): botão "Salvar alterações" voltou.
            Cliente preferiu fluxo manual ao auto-save do PR 26 —
            feedback mais previsível ("eu sei quando salva"). Pra
            evitar perda acidental, useUnsavedChangesGuard avisa ao
            tentar sair com mudanças pendentes. */}
        <Button
          onClick={handleSave}
          disabled={!dirty || isPending}
          className="w-full"
        >
          <Save className="size-4" />
          Salvar alterações
        </Button>
      </div>
    </div>
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
            <Label htmlFor="business_hours_enabled" className="cursor-pointer">
              Respeitar horário comercial
            </Label>
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
                <Label htmlFor="after_hours_message">
                  Mensagem fora do horário
                </Label>
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

