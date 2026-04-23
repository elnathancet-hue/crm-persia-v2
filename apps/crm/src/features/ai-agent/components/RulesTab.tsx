"use client";

import * as React from "react";
import { Info, Save } from "lucide-react";
import type { AgentConfig, AgentGuardrails, UpdateAgentInput } from "@persia/shared/ai-agent";
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

  React.useEffect(() => {
    setPrompt(agent.system_prompt);
    setDescription(agent.description ?? "");
    setModel(agent.model);
    setGuardrails(agent.guardrails);
  }, [agent.id, agent.system_prompt, agent.description, agent.model, agent.guardrails]);

  const promptDirty = prompt !== agent.system_prompt;
  const descriptionDirty = description !== (agent.description ?? "");
  const modelDirty = model !== agent.model;
  const guardrailsDirty =
    guardrails.max_iterations !== agent.guardrails.max_iterations ||
    guardrails.timeout_seconds !== agent.guardrails.timeout_seconds ||
    guardrails.cost_ceiling_tokens !== agent.guardrails.cost_ceiling_tokens ||
    guardrails.allow_human_handoff !== agent.guardrails.allow_human_handoff;

  const dirty = promptDirty || descriptionDirty || modelDirty || guardrailsDirty;

  const handleSave = () => {
    const patch: UpdateAgentInput = {};
    if (promptDirty) patch.system_prompt = prompt;
    if (descriptionDirty) patch.description = description;
    if (modelDirty) patch.model = model;
    if (guardrailsDirty) patch.guardrails = guardrails;
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
