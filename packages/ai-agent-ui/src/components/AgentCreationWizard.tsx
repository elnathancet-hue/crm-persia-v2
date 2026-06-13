"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { DEFAULT_MODEL } from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Switch } from "@persia/ui/switch";
import { cn } from "@persia/ui/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";

// Wizard em 2 steps: 1) Nome + Principal, 2) IA + Resumo.
// Templates removidos — cliente sempre começa do zero e configura
// no canvas. Fluxos pré-montados podem ser reintroduzidos futuramente
// via biblioteca de templates separada.

type WizardStep = 1 | 2;

const MODEL_OPTIONS = [
  {
    value: "gpt-5-mini",
    label: "Padrão (recomendado)",
    tagline: "Bom equilíbrio entre velocidade e qualidade. Comece por aqui.",
  },
  {
    value: "gpt-4o-mini",
    label: "Ágil",
    tagline: "Mais rápido e leve. Bom pra fluxos simples.",
  },
  {
    value: "gpt-4o",
    label: "Avançado",
    tagline: "Qualidade maior pra contextos complexos.",
  },
  {
    value: "gpt-5",
    label: "Premium",
    tagline: "Melhor raciocínio. Use só se realmente precisar.",
  },
] as const;

export interface AgentCreationWizardSubmit {
  name: string;
  description: string;
  model: string;
  isPrimary: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onSubmit: (input: AgentCreationWizardSubmit) => void;
  /** Quando true, o toggle "Principal" começa marcado — útil ao criar o 1º agente. */
  defaultIsPrimary?: boolean;
}

export function AgentCreationWizard({
  open,
  onOpenChange,
  isPending,
  onSubmit,
  defaultIsPrimary = false,
}: Props) {
  const [step, setStep] = React.useState<WizardStep>(1);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [model, setModel] = React.useState<string>(DEFAULT_MODEL);
  const [isPrimaryAgent, setIsPrimaryAgent] = React.useState(defaultIsPrimary);

  // Reset ao fechar — evita state stale na proxima abertura.
  React.useEffect(() => {
    if (!open) {
      setStep(1);
      setName("");
      setDescription("");
      setModel(DEFAULT_MODEL);
      setIsPrimaryAgent(defaultIsPrimary);
    }
  }, [open, defaultIsPrimary]);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 2;

  const handleNext = () => {
    if (step === 1 && nameValid) setStep(2);
  };

  const handleBack = () => {
    if (step === 2) setStep(1);
  };

  const handleCreate = () => {
    if (!nameValid || isPending) return;
    onSubmit({
      name: trimmedName,
      description: description.trim(),
      model,
      isPrimary: isPrimaryAgent,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border bg-card p-5">
          <DialogTitle className="sr-only">Criar agente</DialogTitle>
          <DialogHero
            icon={<Sparkles className="size-5" />}
            title="Criar agente"
            tagline={`Passo ${step} de 2`}
          />
          <StepIndicator step={step} />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {step === 1 && (
            <Step1Identity
              name={name}
              description={description}
              isPrimary={isPrimaryAgent}
              onNameChange={setName}
              onDescriptionChange={setDescription}
              onIsPrimaryChange={setIsPrimaryAgent}
              nameInvalid={trimmedName.length > 0 && !nameValid}
            />
          )}
          {step === 2 && (
            <Step2Model
              name={trimmedName}
              description={description.trim()}
              isPrimary={isPrimaryAgent}
              model={model}
              onModelChange={setModel}
            />
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 border-t border-border bg-card px-6 py-4 flex-row justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={step === 1 ? () => onOpenChange(false) : handleBack}
            disabled={isPending}
            className="min-w-24"
          >
            {step === 1 ? (
              "Cancelar"
            ) : (
              <>
                <ArrowLeft className="size-4" />
                Voltar
              </>
            )}
          </Button>
          {step < 2 ? (
            <Button
              type="button"
              onClick={handleNext}
              disabled={!nameValid || isPending}
              className="min-w-24"
            >
              Próximo
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleCreate}
              disabled={!nameValid || isPending}
              className="min-w-24"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Criar agente
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step }: { step: WizardStep }) {
  const steps: Array<{ id: WizardStep; label: string }> = [
    { id: 1, label: "Identidade" },
    { id: 2, label: "IA" },
  ];
  return (
    <ol className="flex items-center gap-2 mt-3" aria-label="Progresso da criação">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <li className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-5 rounded-full flex items-center justify-center text-[10px] font-semibold transition-colors",
                step === s.id && "bg-primary text-primary-foreground",
                step > s.id && "bg-success text-success-foreground",
                step < s.id && "bg-muted text-muted-foreground",
              )}
              aria-current={step === s.id ? "step" : undefined}
            >
              {step > s.id ? <Check className="size-3" /> : s.id}
            </span>
            <span
              className={cn(
                "text-xs font-medium transition-colors",
                step === s.id ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </li>
          {i < steps.length - 1 ? (
            <div
              className={cn(
                "flex-1 h-px transition-colors",
                step > s.id ? "bg-success" : "bg-border",
              )}
              aria-hidden
            />
          ) : null}
        </React.Fragment>
      ))}
    </ol>
  );
}

function Step1Identity({
  name,
  description,
  isPrimary,
  onNameChange,
  onDescriptionChange,
  onIsPrimaryChange,
  nameInvalid,
}: {
  name: string;
  description: string;
  isPrimary: boolean;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onIsPrimaryChange: (v: boolean) => void;
  nameInvalid: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold tracking-tight">Como vamos chamar?</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Nome e descrição aparecem na sua lista de agentes — só pra te ajudar a identificar.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-name">
          Nome <span className="text-destructive">*</span>
        </Label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Ex: Recepção do WhatsApp"
          maxLength={80}
          aria-invalid={nameInvalid}
          aria-describedby={nameInvalid ? "agent-name-error" : "agent-name-help"}
          className={cn(nameInvalid && "border-destructive")}
          autoFocus
        />
        {nameInvalid ? (
          <p id="agent-name-error" className="text-xs text-destructive">
            Mínimo 2 caracteres.
          </p>
        ) : (
          <p id="agent-name-help" className="text-xs text-muted-foreground">
            Aparece na lista de agentes e nas conversas atribuídas a ele.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-description">Descrição (opcional)</Label>
        <Textarea
          id="agent-description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Ex: Atende leads do WhatsApp e agenda reuniões"
          rows={2}
        />
      </div>

      {/* Principal toggle */}
      <button
        type="button"
        onClick={() => onIsPrimaryChange(!isPrimary)}
        className={cn(
          "flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition-all",
          isPrimary
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40",
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Crown className={cn("size-4 shrink-0", isPrimary ? "text-primary" : "text-muted-foreground")} />
            <p className={cn("text-sm font-semibold", isPrimary ? "text-foreground" : "text-muted-foreground")}>
              Agente principal
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Recebe a primeira mensagem de novos leads automaticamente.
            Só um agente pode ser o principal — ao marcar este, o atual será substituído.
          </p>
        </div>
        <Switch
          checked={isPrimary}
          onCheckedChange={onIsPrimaryChange}
          aria-label="Marcar como agente principal"
          // stopPropagation pra nao duplicar o click do button pai
          onClick={(e) => e.stopPropagation()}
        />
      </button>
    </div>
  );
}

function Step2Model({
  name,
  description,
  isPrimary,
  model,
  onModelChange,
}: {
  name: string;
  description: string;
  isPrimary: boolean;
  model: string;
  onModelChange: (v: string) => void;
}) {
  const selectedModel =
    MODEL_OPTIONS.find((m) => m.value === model) ?? MODEL_OPTIONS[0];
  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold tracking-tight">Inteligência do agente</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Qual nível de IA vai responder pelas conversas. Você pode trocar depois em Configurações.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-model">Modelo de IA</Label>
        <Select value={model} onValueChange={(v) => v && onModelChange(v)}>
          <SelectTrigger id="agent-model" className="w-full">
            <SelectValue>{selectedModel.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MODEL_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{selectedModel.tagline}</p>
      </div>

      <Card className="bg-muted/30">
        <CardContent className="p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Resumo
          </p>
          <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Nome</dt>
            <dd className="font-medium text-foreground">
              {name || <span className="italic text-muted-foreground/60">vazio</span>}
            </dd>
            {description ? (
              <>
                <dt className="text-muted-foreground">Descrição</dt>
                <dd className="text-muted-foreground line-clamp-2">{description}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Principal</dt>
            <dd className={cn("font-medium", isPrimary ? "text-primary" : "text-muted-foreground")}>
              {isPrimary ? "Sim — recebe novos leads" : "Não"}
            </dd>
            <dt className="text-muted-foreground">IA</dt>
            <dd className="font-medium text-foreground">{selectedModel.label}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
