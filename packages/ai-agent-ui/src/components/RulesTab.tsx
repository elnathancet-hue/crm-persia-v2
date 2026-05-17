"use client";

import * as React from "react";
import { CalendarCheck, Info, Save } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentCalendarConnectionPublic,
  AgentConfig,
  AgentGuardrails,
  HandoffNotificationTargetType,
  UpdateAgentInput,
} from "@persia/shared/ai-agent";
import {
  HANDOFF_PHONE_MAX_DIGITS,
  HANDOFF_PHONE_MIN_DIGITS,
  HANDOFF_TEMPLATE_MAX_LENGTH,
} from "@persia/shared/ai-agent";
import { CalendarConnectionsCard } from "./CalendarConnectionsCard";
import { HandoffNotificationCard } from "./HandoffNotificationCard";
import { useAgentActions } from "../context";
import { Button } from "@persia/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@persia/ui/card";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Switch } from "@persia/ui/switch";
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
    calendarConnectionDirty;

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

        {/* PR-AI-AGENT-TOKENS-OUT (mai/2026): card "Guardrails" virou
            "Comportamento" — campos tecnicos (max_iterations, timeout,
            cost_ceiling, debounce, context_summary_*) sairam da UI
            cliente. Token economy fica no backend com defaults sensatos.
            Cliente paga plano fixo. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comportamento</CardTitle>
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

        <HandoffNotificationCard
          draftEnabled={handoffEnabled}
          draftTargetType={handoffTargetType}
          draftTargetAddress={handoffTargetAddress}
          draftTemplate={handoffTemplate}
          onEnabledChange={setHandoffEnabled}
          onTargetTypeChange={setHandoffTargetType}
          onTargetAddressChange={setHandoffTargetAddress}
          onTemplateChange={setHandoffTemplate}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarCheck className="size-4 text-primary" />
              Calendário do agente
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Qual conexão Google o agente usa quando chama
              <code className="font-mono mx-1 text-[11px]">schedule_event</code>.
              Se vazio, o agente não consegue agendar.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="calendar-connection">Conexão atribuída</Label>
            <Select
              value={calendarConnectionId ?? "_none"}
              onValueChange={(v) =>
                setCalendarConnectionId(v && v !== "_none" ? v : null)
              }
              disabled={isPending}
            >
              <SelectTrigger id="calendar-connection">
                <SelectValue
                  placeholder={
                    calendarConnections === null
                      ? "Carregando..."
                      : "Selecione uma conexão"
                  }
                >
                  {calendarConnectionId === null
                    ? "Nenhum (agente sem calendário)"
                    : calendarConnections?.find(
                        (c) => c.id === calendarConnectionId,
                      )?.display_name ?? "Selecione uma conexão"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Nenhum (agente sem calendário)</SelectItem>
                {calendarConnections?.map((conn) => (
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
            {calendarConnections && calendarConnections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma conexão Google ativa nesta org. Use o card abaixo pra
                conectar uma conta antes.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <CalendarConnectionsCard
          initialConnections={calendarConnections ?? undefined}
          returnTo={`/automations/agents/${agent.id}`}
        />

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

