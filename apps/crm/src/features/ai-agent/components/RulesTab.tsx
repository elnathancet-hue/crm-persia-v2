"use client";

import * as React from "react";
import { Info, Save } from "lucide-react";
import type { AgentConfig, AgentGuardrails, UpdateAgentInput } from "@persia/shared/ai-agent";
import {
  CONTEXT_SUMMARY_RECENT_MESSAGES_DEFAULT,
  CONTEXT_SUMMARY_RECENT_MESSAGES_MAX,
  CONTEXT_SUMMARY_RECENT_MESSAGES_MIN,
  CONTEXT_SUMMARY_TOKEN_THRESHOLD_DEFAULT,
  CONTEXT_SUMMARY_TOKEN_THRESHOLD_MAX,
  CONTEXT_SUMMARY_TOKEN_THRESHOLD_MIN,
  CONTEXT_SUMMARY_TURN_THRESHOLD_DEFAULT,
  CONTEXT_SUMMARY_TURN_THRESHOLD_MAX,
  CONTEXT_SUMMARY_TURN_THRESHOLD_MIN,
  DEBOUNCE_WINDOW_MS_DEFAULT,
  DEBOUNCE_WINDOW_MS_MAX,
  DEBOUNCE_WINDOW_MS_MIN,
  clampDebounceWindowMs,
  clampRecentMessagesCount,
  clampTokenThreshold,
  clampTurnThreshold,
} from "@persia/shared/ai-agent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [debounceMs, setDebounceMs] = React.useState<number>(
    clampDebounceWindowMs(agent.debounce_window_ms),
  );
  const [turnThreshold, setTurnThreshold] = React.useState<number>(
    clampTurnThreshold(agent.context_summary_turn_threshold),
  );
  const [tokenThreshold, setTokenThreshold] = React.useState<number>(
    clampTokenThreshold(agent.context_summary_token_threshold),
  );
  const [recentMessages, setRecentMessages] = React.useState<number>(
    clampRecentMessagesCount(agent.context_summary_recent_messages),
  );

  React.useEffect(() => {
    setPrompt(agent.system_prompt);
    setDescription(agent.description ?? "");
    setModel(agent.model);
    setGuardrails(agent.guardrails);
    setDebounceMs(clampDebounceWindowMs(agent.debounce_window_ms));
    setTurnThreshold(clampTurnThreshold(agent.context_summary_turn_threshold));
    setTokenThreshold(clampTokenThreshold(agent.context_summary_token_threshold));
    setRecentMessages(clampRecentMessagesCount(agent.context_summary_recent_messages));
  }, [
    agent.id,
    agent.system_prompt,
    agent.description,
    agent.model,
    agent.guardrails,
    agent.debounce_window_ms,
    agent.context_summary_turn_threshold,
    agent.context_summary_token_threshold,
    agent.context_summary_recent_messages,
  ]);

  const promptDirty = prompt !== agent.system_prompt;
  const descriptionDirty = description !== (agent.description ?? "");
  const modelDirty = model !== agent.model;
  const guardrailsDirty =
    guardrails.max_iterations !== agent.guardrails.max_iterations ||
    guardrails.timeout_seconds !== agent.guardrails.timeout_seconds ||
    guardrails.cost_ceiling_tokens !== agent.guardrails.cost_ceiling_tokens ||
    guardrails.allow_human_handoff !== agent.guardrails.allow_human_handoff;
  const debounceDirty =
    debounceMs !== clampDebounceWindowMs(agent.debounce_window_ms);
  const turnThresholdDirty =
    turnThreshold !== clampTurnThreshold(agent.context_summary_turn_threshold);
  const tokenThresholdDirty =
    tokenThreshold !== clampTokenThreshold(agent.context_summary_token_threshold);
  const recentMessagesDirty =
    recentMessages !== clampRecentMessagesCount(agent.context_summary_recent_messages);

  const dirty =
    promptDirty ||
    descriptionDirty ||
    modelDirty ||
    guardrailsDirty ||
    debounceDirty ||
    turnThresholdDirty ||
    tokenThresholdDirty ||
    recentMessagesDirty;

  const handleSave = () => {
    const patch: UpdateAgentInput = {};
    if (promptDirty) patch.system_prompt = prompt;
    if (descriptionDirty) patch.description = description;
    if (modelDirty) patch.model = model;
    if (guardrailsDirty) patch.guardrails = guardrails;
    if (debounceDirty) patch.debounce_window_ms = debounceMs;
    if (turnThresholdDirty) patch.context_summary_turn_threshold = turnThreshold;
    if (tokenThresholdDirty) patch.context_summary_token_threshold = tokenThreshold;
    if (recentMessagesDirty) patch.context_summary_recent_messages = recentMessages;
    onChange(patch, "Regras salvas");
  };

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instrucoes do agente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Descricao</Label>
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
              Este texto e o contexto geral. Cada etapa adiciona instrucoes especificas por cima.
            </p>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={14}
              className="font-mono text-sm"
              placeholder="Voce e um atendente..."
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
                <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                <SelectItem value="claude-opus-4-7">Claude Opus 4.7</SelectItem>
                <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Guardrails</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <GuardrailField
              id="max_iterations"
              label="Maximo de iteracoes"
              help="Quantas vezes o agente pode chamar ferramentas em uma unica mensagem."
              value={guardrails.max_iterations}
              min={1}
              max={20}
              onChange={(v) => setGuardrails((g) => ({ ...g, max_iterations: v }))}
            />
            <GuardrailField
              id="timeout_seconds"
              label="Timeout (seg)"
              help="Tempo maximo total de resposta por mensagem."
              value={guardrails.timeout_seconds}
              min={5}
              max={120}
              onChange={(v) => setGuardrails((g) => ({ ...g, timeout_seconds: v }))}
            />
            <GuardrailField
              id="cost_ceiling_tokens"
              label="Teto de tokens"
              help="Tokens (input + output) por conversa antes de parar e passar pra humano."
              value={guardrails.cost_ceiling_tokens}
              min={1000}
              max={200000}
              step={1000}
              onChange={(v) => setGuardrails((g) => ({ ...g, cost_ceiling_tokens: v }))}
            />
            <RangeSlider
              id="debounce_window_ms"
              label="Agregar mensagens por"
              valueLabel={`${(debounceMs / 1000).toFixed(0)}s`}
              min={DEBOUNCE_WINDOW_MS_MIN}
              max={DEBOUNCE_WINDOW_MS_MAX}
              step={1000}
              value={debounceMs}
              onChange={(v) => setDebounceMs(clampDebounceWindowMs(v))}
              minLabel={`${DEBOUNCE_WINDOW_MS_MIN / 1000}s`}
              midLabel={`Padrao ${DEBOUNCE_WINDOW_MS_DEFAULT / 1000}s`}
              maxLabel={`${DEBOUNCE_WINDOW_MS_MAX / 1000}s`}
              help="Espera esse tempo por novas mensagens do mesmo lead antes de responder. Evita respostas fragmentadas quando o lead digita em pedacos curtos."
            />
            <RangeSlider
              id="context_summary_turn_threshold"
              label="Consolidar contexto a cada"
              valueLabel={`${turnThreshold} turnos`}
              min={CONTEXT_SUMMARY_TURN_THRESHOLD_MIN}
              max={CONTEXT_SUMMARY_TURN_THRESHOLD_MAX}
              step={1}
              value={turnThreshold}
              onChange={(v) => setTurnThreshold(clampTurnThreshold(v))}
              minLabel={`${CONTEXT_SUMMARY_TURN_THRESHOLD_MIN}`}
              midLabel={`Padrao ${CONTEXT_SUMMARY_TURN_THRESHOLD_DEFAULT}`}
              maxLabel={`${CONTEXT_SUMMARY_TURN_THRESHOLD_MAX}`}
              help="Numero de respostas do agente ate consolidar o historico em um resumo. O que vier primeiro (turnos ou tokens) dispara."
            />
            <RangeSlider
              id="context_summary_token_threshold"
              label="Ou teto de tokens acumulados"
              valueLabel={`${(tokenThreshold / 1000).toFixed(0)}k`}
              min={CONTEXT_SUMMARY_TOKEN_THRESHOLD_MIN}
              max={CONTEXT_SUMMARY_TOKEN_THRESHOLD_MAX}
              step={1000}
              value={tokenThreshold}
              onChange={(v) => setTokenThreshold(clampTokenThreshold(v))}
              minLabel={`${CONTEXT_SUMMARY_TOKEN_THRESHOLD_MIN / 1000}k`}
              midLabel={`Padrao ${CONTEXT_SUMMARY_TOKEN_THRESHOLD_DEFAULT / 1000}k`}
              maxLabel={`${CONTEXT_SUMMARY_TOKEN_THRESHOLD_MAX / 1000}k`}
              help="Soma de tokens (input+output) desde o ultimo resumo. Conversa com mensagens longas dispara mesmo sem atingir os turnos."
            />
            <RangeSlider
              id="context_summary_recent_messages"
              label="Mensagens recentes no contexto"
              valueLabel={`${recentMessages}`}
              min={CONTEXT_SUMMARY_RECENT_MESSAGES_MIN}
              max={CONTEXT_SUMMARY_RECENT_MESSAGES_MAX}
              step={1}
              value={recentMessages}
              onChange={(v) => setRecentMessages(clampRecentMessagesCount(v))}
              minLabel={`${CONTEXT_SUMMARY_RECENT_MESSAGES_MIN}`}
              midLabel={`Padrao ${CONTEXT_SUMMARY_RECENT_MESSAGES_DEFAULT}`}
              maxLabel={`${CONTEXT_SUMMARY_RECENT_MESSAGES_MAX}`}
              help="Depois do resumo, o agente ve apenas as ultimas N mensagens cruas. Valores altos mantem mais detalhe; valores baixos economizam tokens."
            />
            <div className="flex items-start justify-between gap-3 pt-2 border-t">
              <div className="flex-1 min-w-0">
                <Label htmlFor="allow_human_handoff" className="cursor-pointer">
                  Permitir transferir pra humano
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Deixa o agente usar <code>stop_agent</code> quando decidir.
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

        <Button onClick={handleSave} disabled={!dirty || isPending} className="w-full">
          <Save className="size-4" />
          Salvar alteracoes
        </Button>
      </div>
    </div>
  );
}

interface GuardrailFieldProps {
  id: string;
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

function GuardrailField({ id, label, help, value, min, max, step = 1, onChange }: GuardrailFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

interface RangeSliderProps {
  id: string;
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  minLabel: string;
  midLabel: string;
  maxLabel: string;
  help: string;
}

function RangeSlider({
  id,
  label,
  valueLabel,
  min,
  max,
  step = 1,
  value,
  onChange,
  minLabel,
  midLabel,
  maxLabel,
  help,
}: RangeSliderProps) {
  return (
    <div className="space-y-1.5 pt-2 border-t">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums">{valueLabel}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground/70 tabular-nums">
        <span>{minLabel}</span>
        <span>{midLabel}</span>
        <span>{maxLabel}</span>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}
