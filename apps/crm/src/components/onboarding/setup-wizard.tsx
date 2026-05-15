"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@persia/ui/card";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Badge } from "@persia/ui/badge";
import {
  Building2,
  Bot,
  MessageSquare,
  Zap,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import {
  updateOnboardingStep,
  saveAIConfig,
  completeOnboarding,
} from "@/actions/onboarding";

const STEPS = [
  { title: "Seu Negócio", icon: Building2 },
  { title: "IA Configura", icon: Bot },
  { title: "Preview", icon: MessageSquare },
  { title: "Ativar", icon: Zap },
];

interface WizardProps {
  initialStep: number;
  initialData: Record<string, unknown>;
  orgName: string;
  orgNiche: string;
}

export function SetupWizard({
  initialStep,
  initialData,
  orgName,
  orgNiche,
}: WizardProps) {
  const [step, setStep] = useState(Math.min(initialStep || 1, 4));
  const [isPending, startTransition] = useTransition();

  // Step 1 data
  const [description, setDescription] = useState(
    (initialData.description as string) || ""
  );
  const [services, setServices] = useState(
    (initialData.services as string) || ""
  );
  const [schedule, setSchedule] = useState(
    (initialData.schedule as string) || "08:00 - 18:00, segunda a sexta"
  );
  const [address, setAddress] = useState(
    (initialData.address as string) || ""
  );

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setError(field: string, msg: string) {
    setErrors(prev => ({ ...prev, [field]: msg }));
  }

  function clearError(field: string) {
    setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  function validateField(field: string, value: string, rules: { required?: boolean; minLength?: number }) {
    if (rules.required && !value.trim()) { setError(field, "Campo obrigatório"); return false; }
    if (rules.minLength && value.trim().length < rules.minLength) { setError(field, `Mínimo ${rules.minLength} caracteres`); return false; }
    clearError(field);
    return true;
  }

  // Step 2 data
  const [aiConfig, setAiConfig] = useState<Record<string, string> | null>(
    (initialData.aiConfig as Record<string, string>) || null
  );
  const [generating, setGenerating] = useState(false);

  // Step 3 data
  const [testInput, setTestInput] = useState("");
  const [testResponse, setTestResponse] = useState("");
  const [testing, setTesting] = useState(false);

  function goTo(newStep: number) {
    const stepData = { services, schedule, address, description, aiConfig };
    startTransition(async () => {
      await updateOnboardingStep(newStep, stepData);
      setStep(newStep);
    });
  }

  async function generateAIConfig() {
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: orgName,
          niche: orgNiche,
          description,
          services,
          schedule,
          address,
        }),
      });
      const config = await res.json();
      setAiConfig(config);

      await saveAIConfig({
        prompt: config.prompt,
        welcomeMsg: config.welcomeMsg,
        offHoursMsg: config.offHoursMsg,
        schedule: { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] },
        tone: "amigável",
      });
    } catch {
      const fallback = {
        prompt: `Você é o assistente virtual da ${orgName}. Atenda os clientes de forma profissional e cordial. Serviços: ${services}. Horário: ${schedule}.`,
        welcomeMsg: `Olá! Bem-vindo(a) à ${orgName}! Como posso ajudar?`,
        offHoursMsg: `Nosso horário de atendimento é ${schedule}. Deixe sua mensagem!`,
      };
      setAiConfig(fallback);
      await saveAIConfig({
        prompt: fallback.prompt,
        welcomeMsg: fallback.welcomeMsg,
        offHoursMsg: fallback.offHoursMsg,
        schedule: { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] },
        tone: "amigável",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function testAI() {
    if (!testInput.trim()) return;
    setTesting(true);
    setTestResponse("");
    try {
      const res = await fetch("/api/ai/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: orgName,
          niche: orgNiche,
          description,
          services,
          schedule,
          address,
          testMessage: testInput,
        }),
      });
      const data = await res.json();
      setTestResponse(
        data.testResponse ||
          aiConfig?.welcomeMsg ||
          "IA configurada com sucesso!"
      );
    } catch {
      setTestResponse(
        aiConfig?.welcomeMsg || "IA configurada com sucesso!"
      );
    } finally {
      setTesting(false);
    }
  }

  function handleActivate() {
    startTransition(async () => {
      await completeOnboarding();
    });
  }

  const canProceedStep1 = description.trim().length > 10 && services.trim().length > 5;

  return (
    <div className="max-w-xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto">
          <span className="text-primary-foreground font-bold text-xl">P</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Configure sua IA em 5 minutos
        </h1>
        <p className="text-sm text-muted-foreground">
          {orgName} - Passo {step} de {STEPS.length}
        </p>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const isDone = i + 1 < step;
          const isActive = i + 1 === step;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div
                className={`h-1.5 w-full rounded-full transition-colors ${
                  isDone
                    ? "bg-primary"
                    : isActive
                    ? "bg-primary/60"
                    : "bg-muted"
                }`}
              />
              <span
                className={`text-[10px] font-medium ${
                  isActive
                    ? "text-primary"
                    : isDone
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {s.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="p-6 space-y-6">
          {/* STEP 1: Business Info */}
          {step === 1 && (
            <>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Conte sobre seu negócio</h2>
                <p className="text-sm text-muted-foreground">
                  A IA vai usar essas informações para atender seus clientes
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="description">
                    Descreva seu negócio em poucas palavras *
                  </Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => { setDescription(e.target.value); clearError("description"); }}
                    onBlur={() => validateField("description", description, { required: true, minLength: 10 })}
                    placeholder="Ex: Escritório de advocacia especializado em direito trabalhista, com 10 anos de experiência..."
                    rows={3}
                    className={`resize-none ${errors.description ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
                  />
                  {errors.description && <p className="text-xs text-destructive mt-1">{errors.description}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="services">
                    Quais serviços/produtos você oferece? *
                  </Label>
                  <Textarea
                    id="services"
                    value={services}
                    onChange={(e) => { setServices(e.target.value); clearError("services"); }}
                    onBlur={() => validateField("services", services, { required: true, minLength: 5 })}
                    placeholder="Ex: Consultas, processos trabalhistas, acordos, defesa do empregador..."
                    rows={2}
                    className={`resize-none ${errors.services ? "border-destructive focus-visible:ring-destructive/50" : ""}`}
                  />
                  {errors.services && <p className="text-xs text-destructive mt-1">{errors.services}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="schedule">Horário de atendimento</Label>
                    <Input
                      id="schedule"
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                      placeholder="08:00 - 18:00, seg a sex"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Endereço (opcional)</Label>
                    <Input
                      id="address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Rua Principal, 123"
                    />
                  </div>
                </div>
              </div>

              <Button
                className="w-full h-11"
                onClick={() => goTo(2)}
                disabled={!canProceedStep1 || isPending}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Proximo: Gerar IA
                    <ArrowRight className="size-4 ml-2" />
                  </>
                )}
              </Button>
            </>
          )}

          {/* STEP 2: AI Generation */}
          {step === 2 && (
            <>
              {!aiConfig ? (
                <div className="text-center py-6 space-y-5">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <Sparkles className="size-10 text-primary" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-semibold">
                      A IA vai criar tudo para você
                    </h2>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Com base nas informações do seu negócio, vamos gerar o
                      prompt, mensagem de boas-vindas e mensagem fora do horário.
                    </p>
                  </div>
                  <Button
                    size="lg"
                    onClick={generateAIConfig}
                    disabled={generating}
                    className="h-12 px-8"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="size-5 mr-2 animate-spin" />
                        Gerando configuração...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-5 mr-2" />
                        Gerar com IA
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-success-soft text-success border-success-ring">
                      <CheckCircle2 className="size-3 mr-1" />
                      Configuração gerada
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setAiConfig(null);
                      }}
                    >
                      Gerar novamente
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>Prompt do Assistente</Label>
                    <Textarea
                      value={aiConfig.prompt || ""}
                      onChange={(e) =>
                        setAiConfig({ ...aiConfig, prompt: e.target.value })
                      }
                      rows={5}
                      className="resize-none text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Instrucoes que a IA segue ao conversar com seus clientes
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Mensagem de Boas-Vindas</Label>
                    <Textarea
                      value={aiConfig.welcomeMsg || ""}
                      onChange={(e) =>
                        setAiConfig({
                          ...aiConfig,
                          welcomeMsg: e.target.value,
                        })
                      }
                      rows={2}
                      className="resize-none text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Mensagem Fora do Horário</Label>
                    <Textarea
                      value={aiConfig.offHoursMsg || ""}
                      onChange={(e) =>
                        setAiConfig({
                          ...aiConfig,
                          offHoursMsg: e.target.value,
                        })
                      }
                      rows={2}
                      className="resize-none text-sm"
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => goTo(1)}>
                      <ArrowLeft className="size-4 mr-2" />
                      Voltar
                    </Button>
                    <Button
                      className="flex-1 h-11"
                      onClick={async () => {
                        await saveAIConfig({
                          prompt: aiConfig.prompt || "",
                          welcomeMsg: aiConfig.welcomeMsg || "",
                          offHoursMsg: aiConfig.offHoursMsg || "",
                          schedule: {
                            start: "08:00",
                            end: "18:00",
                            days: [1, 2, 3, 4, 5],
                          },
                          tone: "amigável",
                        });
                        goTo(3);
                      }}
                      disabled={isPending}
                    >
                      {isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          Proximo: Testar
                          <ArrowRight className="size-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* STEP 3: Preview & Test */}
          {step === 3 && (
            <>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Teste sua IA</h2>
                <p className="text-sm text-muted-foreground">
                  Simule uma conversa para ver como a IA vai responder
                </p>
              </div>

              {/* Chat preview */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3 max-h-64 overflow-y-auto">
                {/* Welcome message */}
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="size-3.5 text-primary" />
                  </div>
                  <div className="bg-background rounded-2xl rounded-bl-sm px-3 py-2 text-sm max-w-[85%]">
                    {aiConfig?.welcomeMsg || "Ola! Como posso ajudar?"}
                  </div>
                </div>

                {/* User test message */}
                {testInput && (
                  <div className="flex justify-end">
                    <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-sm max-w-[85%]">
                      {testInput}
                    </div>
                  </div>
                )}

                {/* AI response */}
                {testResponse && (
                  <div className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Bot className="size-3.5 text-primary" />
                    </div>
                    <div className="bg-background rounded-2xl rounded-bl-sm px-3 py-2 text-sm max-w-[85%]">
                      {testResponse}
                    </div>
                  </div>
                )}

                {testing && (
                  <div className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Bot className="size-3.5 text-primary" />
                    </div>
                    <div className="bg-background rounded-2xl rounded-bl-sm px-3 py-2">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>

              {/* Test input */}
              <div className="flex gap-2">
                <Input
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  placeholder="Digite uma pergunta de teste..."
                  onKeyDown={(e) => e.key === "Enter" && testAI()}
                  className="h-10"
                />
                <Button onClick={testAI} disabled={testing || !testInput.trim()}>
                  {testing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Testar"
                  )}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Esta é uma simulação. As respostas reais podem variar no WhatsApp.
              </p>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => goTo(2)}>
                  <ArrowLeft className="size-4 mr-2" />
                  Voltar
                </Button>
                <Button className="flex-1 h-11" onClick={() => goTo(4)} disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Proximo: Ativar
                      <ArrowRight className="size-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {/* STEP 4: Activate */}
          {step === 4 && (
            <div className="text-center py-6 space-y-6">
              <div className="w-24 h-24 rounded-full bg-success-soft flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-12 text-success" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold">Tudo pronto!</h2>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  Sua IA esta configurada. Quando o WhatsApp for conectado pelo
                  suporte, ela comecara a responder automaticamente.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center py-4">
                <div>
                  <p className="text-2xl font-bold text-primary">24/7</p>
                  <p className="text-xs text-muted-foreground">IA ativa</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">0</p>
                  <p className="text-xs text-muted-foreground">Tutoriais</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">5 min</p>
                  <p className="text-xs text-muted-foreground">Setup</p>
                </div>
              </div>

              <Button
                size="lg"
                onClick={handleActivate}
                disabled={isPending}
                className="h-12 px-8 bg-success text-success-foreground hover:bg-success/90"
              >
                {isPending ? (
                  <>
                    <Loader2 className="size-5 mr-2 animate-spin" />
                    Ativando...
                  </>
                ) : (
                  <>
                    <Zap className="size-5 mr-2" />
                    Ir para o Dashboard
                  </>
                )}
              </Button>

              <Button variant="link" onClick={() => goTo(2)} className="text-xs">
                Voltar e ajustar configuração
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
