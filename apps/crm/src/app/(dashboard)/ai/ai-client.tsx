"use client";

import * as React from "react";
import { Bot, Send, Loader2, Save, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ToneSelector } from "@/components/ai/tone-selector";
import { ScheduleConfig } from "@/components/ai/schedule-config";
import { createAssistant, updateAssistant, testAssistant } from "@/actions/ai";

interface MessageSplitting {
  enabled: boolean;
  threshold: number;
  delay_seconds: number;
}

interface Assistant {
  id: string;
  organization_id: string;
  name: string;
  prompt: string;
  welcome_msg: string | null;
  off_hours_msg: string | null;
  schedule: unknown;
  tone: string;
  model: string;
  is_active: boolean;
  total_tokens_used: number;
  total_conversations: number;
  message_splitting: MessageSplitting | null;
  created_at: string;
  updated_at: string;
}

interface ScheduleData {
  start: string;
  end: string;
  days: number[];
}

const DEFAULT_SCHEDULE: ScheduleData = {
  start: "09:00",
  end: "18:00",
  days: [1, 2, 3, 4, 5],
};

function parseSchedule(raw: unknown): ScheduleData {
  if (raw && typeof raw === "object" && "start" in raw && "end" in raw && "days" in raw) {
    const s = raw as { start: string; end: string; days: number[] };
    return {
      start: s.start || "09:00",
      end: s.end || "18:00",
      days: Array.isArray(s.days) ? s.days : [1, 2, 3, 4, 5],
    };
  }
  return DEFAULT_SCHEDULE;
}

interface AIPageClientProps {
  initialAssistant: Assistant | null;
}

export function AIPageClient({ initialAssistant }: AIPageClientProps) {
  const [assistant, setAssistant] = React.useState<Assistant | null>(initialAssistant);
  const [name, setName] = React.useState(assistant?.name || "Assistente IA");
  const [prompt, setPrompt] = React.useState(assistant?.prompt || "");
  const [welcomeMsg, setWelcomeMsg] = React.useState(assistant?.welcome_msg || "");
  const [offHoursMsg, setOffHoursMsg] = React.useState(assistant?.off_hours_msg || "");
  const [tone, setTone] = React.useState(assistant?.tone || "amigavel");
  const [schedule, setSchedule] = React.useState<ScheduleData>(
    parseSchedule(assistant?.schedule)
  );
  const [isActive, setIsActive] = React.useState(assistant?.is_active ?? true);
  const [splitEnabled, setSplitEnabled] = React.useState(assistant?.message_splitting?.enabled ?? false);
  const [splitThreshold, setSplitThreshold] = React.useState(String(assistant?.message_splitting?.threshold ?? 100));
  const [splitDelay, setSplitDelay] = React.useState(String(assistant?.message_splitting?.delay_seconds ?? 2));
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Test section
  const [testMessage, setTestMessage] = React.useState("");
  const [testResponse, setTestResponse] = React.useState("");
  const [testError, setTestError] = React.useState("");
  const [testing, setTesting] = React.useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const data = {
        name,
        prompt,
        welcome_msg: welcomeMsg || undefined,
        off_hours_msg: offHoursMsg || undefined,
        tone,
        schedule: schedule as any,
        is_active: isActive,
        message_splitting: {
          enabled: splitEnabled,
          threshold: parseInt(splitThreshold) || 100,
          delay_seconds: parseFloat(splitDelay) || 2,
        },
      };

      if (assistant) {
        await updateAssistant(assistant.id, data as any);
        setAssistant({ ...assistant, ...data, schedule } as Assistant);
      } else {
        if (!prompt.trim()) return;
        const newAssistant = await createAssistant({
          ...data,
          prompt: prompt || "Você é um assistente de atendimento.",
        });
        if (newAssistant) {
          setAssistant(newAssistant as Assistant);
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!testMessage.trim() || !assistant) return;
    setTesting(true);
    setTestResponse("");
    setTestError("");
    try {
      const result = await testAssistant(assistant.id, testMessage);
      if (result.error) {
        setTestError(result.error);
      } else {
        setTestResponse(result.response);
      }
    } catch {
      setTestError("Erro ao testar o assistente");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status and Active Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                {isActive
                  ? "O assistente esta ativo e respondendo mensagens"
                  : "O assistente esta desativado"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {isActive ? "Ativo" : "Inativo"}
              </span>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Basic Config */}
      <Card>
        <CardHeader>
          <CardTitle>Configuração Geral</CardTitle>
          <CardDescription>
            Defina o nome e as instruções do assistente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assistant-name">Nome do Assistente</Label>
            <Input
              id="assistant-name"
              placeholder="Ex: Atendente Virtual"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assistant-prompt">
              Prompt (Instrucoes)
            </Label>
            <Textarea
              id="assistant-prompt"
              placeholder="Descreva como o assistente deve se comportar, quais informacoes da empresa ele deve saber, o que pode e nao pode fazer..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-32"
            />
            <p className="text-xs text-muted-foreground">
              Quanto mais detalhado, melhor sera o atendimento
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="welcome-msg">Mensagem de Boas-vindas</Label>
            <Textarea
              id="welcome-msg"
              placeholder="Ola! Bem-vindo(a)! Como posso ajudar?"
              value={welcomeMsg}
              onChange={(e) => setWelcomeMsg(e.target.value)}
              className="min-h-16"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offhours-msg">Mensagem Fora do Horário</Label>
            <Textarea
              id="offhours-msg"
              placeholder="Nosso horário de atendimento é de segunda a sexta, das 9h às 18h..."
              value={offHoursMsg}
              onChange={(e) => setOffHoursMsg(e.target.value)}
              className="min-h-16"
            />
          </div>
        </CardContent>
      </Card>

      {/* Tone Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Tom de Conversa</CardTitle>
          <CardDescription>
            Escolha como o assistente deve se comunicar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToneSelector value={tone} onChange={setTone} />
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Horário de Atendimento</CardTitle>
          <CardDescription>
            Defina quando o assistente deve responder automaticamente
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScheduleConfig value={schedule} onChange={setSchedule} />
        </CardContent>
      </Card>

      {/* Message Splitting */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Scissors className="size-5" />
                Picotador de Mensagens
              </CardTitle>
              <CardDescription>
                Divide respostas longas da IA em mensagens curtas e naturais, simulando uma conversa real no WhatsApp
              </CardDescription>
            </div>
            <Switch
              checked={splitEnabled}
              onCheckedChange={setSplitEnabled}
            />
          </div>
        </CardHeader>
        {splitEnabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="split-threshold">Tamanho minimo (caracteres)</Label>
                <Input
                  id="split-threshold"
                  type="number"
                  min="50"
                  max="500"
                  value={splitThreshold}
                  onChange={(e) => setSplitThreshold(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Mensagens menores que esse valor nao serao divididas
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="split-delay">Delay entre mensagens (segundos)</Label>
                <Input
                  id="split-delay"
                  type="number"
                  min="1"
                  max="10"
                  step="0.5"
                  value={splitDelay}
                  onChange={(e) => setSplitDelay(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Tempo de espera entre cada mensagem enviada
                </p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {saving ? "Salvando..." : "Salvar Configurações"}
        </Button>
        {saved && (
          <span className="text-sm text-green-600">Salvo com sucesso!</span>
        )}
      </div>

      {/* Test Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-5" />
            Testar IA
          </CardTitle>
          <CardDescription>
            Envie uma mensagem de teste para ver como o assistente responde
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!assistant ? (
            <p className="text-sm text-muted-foreground">
              Salve as configuracoes primeiro para poder testar o assistente.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Digite uma mensagem de teste..."
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleTest();
                    }
                  }}
                />
                <Button
                  onClick={handleTest}
                  disabled={testing || !testMessage.trim()}
                >
                  {testing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>

              {testing && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Gerando resposta...
                </div>
              )}

              {testError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {testError}
                </div>
              )}

              {testResponse && (
                <div className="space-y-2">
                  <Label>Resposta do Assistente:</Label>
                  <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">
                    {testResponse}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
