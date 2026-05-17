"use client";

import * as React from "react";
import { CalendarCheck, Info, Save } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentCalendarConnectionPublic,
  AgentConfig,
  AgentGuardrails,
  HandoffNotificationTargetType,
  HumanizationConfig,
  UpdateAgentInput,
} from "@persia/shared/ai-agent";
import {
  AFTER_HOURS_MESSAGE_DEFAULT,
  AFTER_HOURS_MESSAGE_MAX_LENGTH,
  AUTO_PAUSE_MINUTES_DEFAULT,
  AUTO_PAUSE_MINUTES_MAX,
  BUSINESS_HOURS_DEFAULT,
  DAY_NAMES,
  HANDOFF_PHONE_MAX_DIGITS,
  HANDOFF_PHONE_MIN_DIGITS,
  HANDOFF_TEMPLATE_MAX_LENGTH,
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
import { CalendarConnectionsCard } from "./CalendarConnectionsCard";
import { HandoffNotificationCard } from "./HandoffNotificationCard";
import { useAgentActions } from "../context";
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
}

export function RulesTab({ agent, onChange, isPending }: Props) {
  const [prompt, setPrompt] = React.useState(agent.system_prompt);
  const [description, setDescription] = React.useState(agent.description ?? "");
  const [model, setModel] = React.useState(agent.model);
  const [guardrails, setGuardrails] = React.useState<AgentGuardrails>(agent.guardrails);
  const [handoffEnabled, setHandoffEnabled] = React.useState<boolean>(
    Boolean(agent.handoff_notification_enabled),
  );
  const [handoffTargetType, setHandoffTargetType] = React.useState<HandoffNotificationTargetType | null>(
    agent.handoff_notification_target_type ?? null,
  );
  const [handoffTargetAddress, setHandoffTargetAddress] = React.useState<string>(
    agent.handoff_notification_target_address ?? "",
  );
  const [handoffTemplate, setHandoffTemplate] = React.useState<string>(
    agent.handoff_notification_template ?? "",
  );
  const [calendarConnectionId, setCalendarConnectionId] = React.useState<
    string | null
  >(agent.calendar_connection_id ?? null);
  const [calendarConnections, setCalendarConnections] = React.useState<
    AgentCalendarConnectionPublic[] | null
  >(null);
  // PR-AGENT-INTEGRATION-1: include summary inicializa do humanization_config
  // (default true). Effect abaixo refresca quando agent muda.
  const [handoffIncludeSummary, setHandoffIncludeSummary] = React.useState<boolean>(
    () => normalizeHumanizationConfig(agent.humanization_config).handoff_include_summary,
  );

  // PR-AI-AGENT-HUMAN-A: humanization (pausa/ativa). UI usa textareas
  // pra editar keywords como texto livre (1 por linha) — mais intuitivo
  // que multi-input. Persistencia normaliza via sanitizeKeywordList.
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
    setHandoffEnabled(Boolean(agent.handoff_notification_enabled));
    setHandoffTargetType(agent.handoff_notification_target_type ?? null);
    setHandoffTargetAddress(agent.handoff_notification_target_address ?? "");
    setHandoffTemplate(agent.handoff_notification_template ?? "");
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
    setHandoffIncludeSummary(next.handoff_include_summary);
  }, [
    agent.id,
    agent.system_prompt,
    agent.description,
    agent.model,
    agent.guardrails,
    agent.handoff_notification_enabled,
    agent.handoff_notification_target_type,
    agent.handoff_notification_target_address,
    agent.handoff_notification_template,
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
  const handoffEnabledDirty =
    handoffEnabled !== Boolean(agent.handoff_notification_enabled);
  const handoffTargetTypeDirty =
    handoffTargetType !== (agent.handoff_notification_target_type ?? null);
  const handoffAddressDirty =
    handoffTargetAddress !== (agent.handoff_notification_target_address ?? "");
  const handoffTemplateDirty =
    handoffTemplate !== (agent.handoff_notification_template ?? "");
  const handoffDirty =
    handoffEnabledDirty ||
    handoffTargetTypeDirty ||
    handoffAddressDirty ||
    handoffTemplateDirty;
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
    nextAfterHoursMessage !== initialHumanization.after_hours_message ||
    handoffIncludeSummary !== initialHumanization.handoff_include_summary;

  // Client-side validation that mirrors the server (lets the Save button
  // disable proactively on bad data — server still re-validates).
  const handoffPhoneDigits = handoffTargetAddress.replace(/\D/g, "");
  const handoffPhoneInvalid =
    handoffEnabled &&
    handoffTargetType === "phone" &&
    (handoffPhoneDigits.length < HANDOFF_PHONE_MIN_DIGITS ||
      handoffPhoneDigits.length > HANDOFF_PHONE_MAX_DIGITS);
  const handoffAddressMissing = handoffEnabled && !handoffTargetAddress.trim();
  const handoffTargetTypeMissing = handoffEnabled && !handoffTargetType;
  const handoffTemplateTooLong = handoffTemplate.length > HANDOFF_TEMPLATE_MAX_LENGTH;
  const handoffInvalid =
    handoffAddressMissing ||
    handoffTargetTypeMissing ||
    handoffPhoneInvalid ||
    handoffTemplateTooLong;

  const dirty =
    promptDirty ||
    descriptionDirty ||
    modelDirty ||
    guardrailsDirty ||
    handoffDirty ||
    calendarConnectionDirty ||
    humanizationDirty;

  const handleSave = () => {
    const patch: UpdateAgentInput = {};
    if (promptDirty) patch.system_prompt = prompt;
    if (descriptionDirty) patch.description = description;
    if (modelDirty) patch.model = model;
    if (guardrailsDirty) patch.guardrails = guardrails;
    if (handoffEnabledDirty) patch.handoff_notification_enabled = handoffEnabled;
    if (handoffTargetTypeDirty) patch.handoff_notification_target_type = handoffTargetType;
    if (handoffAddressDirty) {
      patch.handoff_notification_target_address = handoffTargetAddress.trim() || null;
    }
    if (handoffTemplateDirty) {
      patch.handoff_notification_template = handoffTemplate.trim() || null;
    }
    if (calendarConnectionDirty) {
      patch.calendar_connection_id = calendarConnectionId;
    }
    if (humanizationDirty) {
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
        handoff_include_summary: handoffIncludeSummary,
      };
    }
    onChange(patch, "Regras salvas");
  };

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
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
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt base</Label>
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              Este texto é o contexto geral. Cada etapa adiciona instruções específicas por cima.
            </p>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={14}
              className="font-mono text-sm"
              placeholder="Você é um atendente..."
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modelo</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={model} onValueChange={(v) => v && setModel(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-5-mini">GPT-5 mini (padrão)</SelectItem>
                <SelectItem value="gpt-4o-mini">GPT-4o mini</SelectItem>
                <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                <SelectItem value="gpt-5">GPT-5</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* PR-AGENT-INTEGRATION-1 (mai/2026): card "Comportamento" virou
            "Transferir pra humano". O switch principal libera a IA usar
            `stop_agent`; quando on, o HandoffNotificationCard abaixo
            permite configurar notificacao + resumo da conversa. Antes
            esses 2 cards estavam separados visualmente. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transferir pra humano</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <Label htmlFor="allow_human_handoff" className="cursor-pointer">
                  Permitir transferir pra humano
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Deixa o agente passar a conversa pra um atendente quando
                  detectar que está fora do escopo dele.
                </p>
              </div>
              <Switch
                id="allow_human_handoff"
                checked={guardrails.allow_human_handoff}
                onCheckedChange={(v) =>
                  setGuardrails((g) => ({ ...g, allow_human_handoff: Boolean(v) }))
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* HandoffNotificationCard so faz sentido quando o agente pode
            transferir. Quando allow_human_handoff = off, esconde —
            evita cliente configurar template que nunca dispara. */}
        {guardrails.allow_human_handoff ? (
          <HandoffNotificationCard
            draftEnabled={handoffEnabled}
            draftTargetType={handoffTargetType}
            draftTargetAddress={handoffTargetAddress}
            draftTemplate={handoffTemplate}
            draftIncludeSummary={handoffIncludeSummary}
            onEnabledChange={setHandoffEnabled}
            onTargetTypeChange={setHandoffTargetType}
            onTargetAddressChange={setHandoffTargetAddress}
            onTemplateChange={setHandoffTemplate}
            onIncludeSummaryChange={setHandoffIncludeSummary}
          />
        ) : null}

        {/* PR-AI-AGENT-HUMAN-A: card de humanizacao (pausa/ativa). Toggle
            do auto_pause_minutes serve de master switch: off = pausa
            permanente quando humano responde ou keyword (so resume manual
            reativa). on = pausa por X min e auto-reativa proxima msg do
            lead. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pausa e ativação</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              O lead pode digitar palavras pra pausar ou reativar o agente. Se
              um atendente humano responder pelo chat, o agente também pausa
              automaticamente.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <Label htmlFor="auto_pause_enabled" className="cursor-pointer">
                  Auto-pausa quando humano responde
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Quando um atendente responde, o agente fica em silêncio por
                  um tempo. Próxima mensagem do lead reativa automaticamente.
                </p>
              </div>
              <Switch
                id="auto_pause_enabled"
                checked={humanizationEnabled}
                onCheckedChange={(v) => setHumanizationEnabled(Boolean(v))}
              />
            </div>

            {humanizationEnabled ? (
              <div className="space-y-1.5 pl-0">
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
                    setAutoPauseMinutes(clampAutoPauseMinutes(Number(e.target.value)))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Tempo recomendado: 30 minutos. Máximo 1440 (24h).
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5 pt-2 border-t">
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
                Uma palavra por linha. Quando o lead digitar uma delas (sem
                outras palavras), o agente para de responder. Não diferencia
                maiúscula/minúscula.
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
                Uma palavra por linha. Faz o agente voltar a responder se
                estiver pausado.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* PR-AI-AGENT-HUMAN-B: card de split de mensagens. Conservador
            por default (off) pra evitar custo extra de GPT call e
            mudancas de UX inesperadas. Toggle on libera 2 inputs. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dividir respostas longas</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Quando o agente escrever uma resposta grande, divide
              automaticamente em várias mensagens curtas no WhatsApp — parece
              mais humano.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <div className="space-y-1.5 pt-2 border-t">
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
                    (~3 linhas). Valores entre {SPLIT_THRESHOLD_CHARS_MIN}{" "}
                    e {SPLIT_THRESHOLD_CHARS_MAX}.
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
          </CardContent>
        </Card>

        <BusinessHoursCard
          enabled={businessHoursEnabled}
          hours={businessHours}
          afterHoursMessage={afterHoursMessage}
          onEnabledChange={setBusinessHoursEnabled}
          onHoursChange={setBusinessHours}
          onAfterHoursMessageChange={setAfterHoursMessage}
        />

        {/* PR-AGENT-INTEGRATION-1: card de calendario reorganizado.
            Agenda interna (create_appointment via tools) ja funciona —
            agente agenda sem precisar de conexao externa. Google Calendar
            integration esta em desenvolvimento (handler schedule_event
            no enum mas sem TS handler). */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarCheck className="size-4 text-primary" />
              Calendário do agente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-success-ring bg-success-soft/30 p-3">
              <div className="flex items-start gap-2">
                <span className="size-2 rounded-full bg-success mt-1.5 shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Agenda interna — ativa
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Quando o agente agenda via chat, o compromisso entra
                    direto na sua Agenda do CRM. Sem precisar de Google.
                    Ative a ferramenta "Agendar reunião" pra liberar.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-start gap-2">
                <span className="size-2 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-muted-foreground">
                      Google Calendar
                    </p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-soft text-warning-soft-foreground font-medium">
                      Em breve
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sincronização com Google Calendar está em desenvolvimento.
                    Por enquanto, use a agenda interna acima.
                  </p>
                </div>
              </div>
            </div>

            {/* Mantemos a config de conexao Google escondida atras de
                "Avancado" — agentes legados que ja tinham conexao
                continuam funcionando, mas escondemos do leigo. */}
            {calendarConnections && calendarConnections.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                  Avançado: escolher conexão Google
                </summary>
                <div className="mt-3 space-y-2 pl-2 border-l-2 border-muted">
                  <Label htmlFor="calendar-connection" className="text-xs">
                    Conexão atribuída
                  </Label>
                  <Select
                    value={calendarConnectionId ?? "_none"}
                    onValueChange={(v) =>
                      setCalendarConnectionId(v && v !== "_none" ? v : null)
                    }
                    disabled={isPending}
                  >
                    <SelectTrigger id="calendar-connection">
                      <SelectValue>
                        {calendarConnectionId === null
                          ? "Nenhum (usa agenda interna)"
                          : calendarConnections?.find(
                              (c) => c.id === calendarConnectionId,
                            )?.display_name ?? "Selecione uma conexão"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">
                        Nenhum (usa agenda interna)
                      </SelectItem>
                      {calendarConnections.map((conn) => (
                        <SelectItem
                          key={conn.id}
                          value={conn.id}
                          disabled={conn.status !== "active"}
                        >
                          {conn.display_name}
                          {conn.status !== "active" ? (
                            <span className="text-muted-foreground"> ({conn.status})</span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>

        {/* CalendarConnectionsCard escondido atrás de details "Avançado"
            quando ja existem conexoes. Em breve sera removido daqui
            inteiramente — Google esta em dev. Por enquanto, mantemos
            via details pra nao quebrar fluxo de devs/admins. */}
        {calendarConnections && calendarConnections.length > 0 ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none px-1 py-2">
              Gerenciar conexões Google (avançado, em desenvolvimento)
            </summary>
            <div className="mt-2">
              <CalendarConnectionsCard
                initialConnections={calendarConnections ?? undefined}
                returnTo={`/automations/agents/${agent.id}`}
              />
            </div>
          </details>
        ) : null}

        <Button
          onClick={handleSave}
          disabled={!dirty || isPending || handoffInvalid}
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

interface BusinessHoursCardProps {
  enabled: boolean;
  hours: BusinessHours;
  afterHoursMessage: string;
  onEnabledChange: (v: boolean) => void;
  onHoursChange: (next: BusinessHours) => void;
  onAfterHoursMessageChange: (next: string) => void;
}

function BusinessHoursCard({
  enabled,
  hours,
  afterHoursMessage,
  onEnabledChange,
  onHoursChange,
  onAfterHoursMessageChange,
}: BusinessHoursCardProps) {
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Horário comercial</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Limita os horários que o agente responde. Fora do horário, manda uma
          mensagem padrão e deixa a conversa pra você responder depois.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  );
}

