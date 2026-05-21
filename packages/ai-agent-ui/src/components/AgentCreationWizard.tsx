"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CreditCard,
  FilePlus,
  Headphones,
  Loader2,
  Plus,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  AGENT_TEMPLATES,
  DEFAULT_MODEL,
  type AgentTemplate,
  type AgentTemplateSlug,
} from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
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

// PR-AI-AGENT-WIZARD (mai/2026): substitui o Dialog single-form de "Novo
// agente" por wizard em 3 steps. Razao:
// - Cliente leigo via 1 form gigante com 4 campos + select de template
//   (com descricao em prosa) — abandonava ou criava com "blank" por nao
//   ler a descricao.
// - 3 steps quebram a decisao em escolhas pequenas (Hick-Hyman): 1)
//   visual de template, 2) nome, 3) modelo de IA.
// - Templates viram cards visuais com icone + cor tematica em vez de
//   linha de Select — recognition over recall.
// - Step indicator (Modelo > Nome > IA) com check verde + linha conectora
//   sinaliza progresso e permite voltar a qualquer momento.
//
// Server actions inalteradas: ao submeter, dispara o mesmo createAgent
// com template_slug — backend ja materializa stages do template.

// Visual por template — icone + acento de cor. Decoupled do shared
// (que so tem dados semanticos: label, prompt, stages).
const TEMPLATE_VISUALS: Record<
  AgentTemplateSlug,
  {
    Icon: React.ComponentType<{ className?: string }>;
    accent: string;
    iconColor: string;
  }
> = {
  blank: {
    Icon: FilePlus,
    accent: "from-muted to-muted",
    iconColor: "bg-muted text-muted-foreground",
  },
  atendimento_whatsapp: {
    Icon: Headphones,
    accent: "from-primary/15 to-primary/5",
    iconColor: "bg-primary/15 text-primary",
  },
  pre_venda: {
    Icon: TrendingUp,
    accent: "from-success/15 to-success/5",
    iconColor: "bg-success-soft text-success-soft-foreground",
  },
  pos_venda_cobranca: {
    Icon: CreditCard,
    accent: "from-warning/15 to-warning/5",
    iconColor: "bg-warning-soft text-warning-soft-foreground",
  },
  tira_duvidas_faq: {
    Icon: BookOpen,
    accent: "from-progress/15 to-progress/5",
    iconColor: "bg-progress-soft text-progress-soft-foreground",
  },
  consultor_funil_completo: {
    Icon: Zap,
    accent: "from-primary/20 to-primary/5",
    iconColor: "bg-primary/20 text-primary",
  },
};

type WizardStep = 1 | 2 | 3;

const MODEL_OPTIONS = [
  {
    value: "gpt-5-mini",
    label: "Padrão (recomendado)",
    tagline: "Bom equilíbrio entre custo e qualidade. Comece por aqui.",
  },
  {
    value: "gpt-4o-mini",
    label: "Econômico",
    tagline: "Mais rápido e barato. Bom pra fluxos simples.",
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
  templateSlug: AgentTemplateSlug;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onSubmit: (input: AgentCreationWizardSubmit) => void;
}

export function AgentCreationWizard({
  open,
  onOpenChange,
  isPending,
  onSubmit,
}: Props) {
  const [step, setStep] = React.useState<WizardStep>(1);
  const [templateSlug, setTemplateSlug] =
    React.useState<AgentTemplateSlug>("blank");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [model, setModel] = React.useState<string>(DEFAULT_MODEL);

  // Reset ao fechar — evita state stale na proxima abertura.
  React.useEffect(() => {
    if (!open) {
      setStep(1);
      setTemplateSlug("blank");
      setName("");
      setDescription("");
      setModel(DEFAULT_MODEL);
    }
  }, [open]);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 2;
  const canAdvanceFromStep2 = nameValid;
  const selectedTemplate = AGENT_TEMPLATES.find((t) => t.slug === templateSlug)!;

  const handleNext = () => {
    if (step === 1) setStep(2);
    else if (step === 2 && canAdvanceFromStep2) setStep(3);
  };

  const handleBack = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  const handleCreate = () => {
    if (!nameValid || isPending) return;
    onSubmit({
      name: trimmedName,
      description: description.trim(),
      model,
      templateSlug,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border bg-card p-5">
          <DialogTitle className="sr-only">Criar agente</DialogTitle>
          <DialogHero
            icon={<Sparkles className="size-5" />}
            title="Criar agente"
            tagline={`Passo ${step} de 3`}
          />
          <StepIndicator step={step} />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {step === 1 && (
            <Step1Template value={templateSlug} onChange={setTemplateSlug} />
          )}
          {step === 2 && (
            <Step2Identity
              template={selectedTemplate}
              name={name}
              description={description}
              onNameChange={setName}
              onDescriptionChange={setDescription}
              nameInvalid={trimmedName.length > 0 && !nameValid}
            />
          )}
          {step === 3 && (
            <Step3Model
              template={selectedTemplate}
              name={trimmedName}
              description={description.trim()}
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
          {step < 3 ? (
            <Button
              type="button"
              onClick={handleNext}
              disabled={(step === 2 && !canAdvanceFromStep2) || isPending}
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
  // PR 17 UX (mai/2026): "Modelo" virou ambíguo (template VS LLM model).
  // Step 1 agora é "Tipo de atendimento" — descreve melhor o que cliente
  // está escolhendo (fluxo pré-montado pra cada caso de uso).
  const steps: Array<{ id: WizardStep; label: string }> = [
    { id: 1, label: "Tipo de atendimento" },
    { id: 2, label: "Nome" },
    { id: 3, label: "IA" },
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

function Step1Template({
  value,
  onChange,
}: {
  value: AgentTemplateSlug;
  onChange: (slug: AgentTemplateSlug) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold tracking-tight">
          Que tipo de atendimento o agente vai fazer?
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Escolha o cenário mais parecido com o seu. Cada opção já vem com
          um fluxo pré-montado pra acelerar o setup — você pode revisar e
          refinar antes de ativar
          depois.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {AGENT_TEMPLATES.map((tpl) => (
          <TemplateCard
            key={tpl.slug}
            template={tpl}
            selected={value === tpl.slug}
            onSelect={() => onChange(tpl.slug)}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: AgentTemplate;
  selected: boolean;
  onSelect: () => void;
}) {
  const visual = TEMPLATE_VISUALS[template.slug];
  const Icon = visual.Icon;
  // PR-FLOW-PIVOT: template não tem mais `stages` array. V1 mostra label
  // genérico — PRs subsequentes vão exibir contagem de nodes do flow_config.
  const stagesLabel =
    template.slug === "blank" ? "Flow vazio" : "Flow pronto";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative text-left rounded-xl border-2 p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        selected
          ? `border-primary shadow-md shadow-primary/10 bg-gradient-to-br ${visual.accent}`
          : "border-border hover:border-primary/40 hover:shadow-sm bg-card",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "size-10 rounded-xl flex items-center justify-center shrink-0",
            visual.iconColor,
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-sm tracking-tight leading-tight">
              {template.label}
            </p>
            {selected ? (
              <Check className="size-4 text-primary shrink-0" aria-hidden />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {template.short_description}
          </p>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider pt-1">
            {stagesLabel}
          </p>
        </div>
      </div>
    </button>
  );
}

function Step2Identity({
  template,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  nameInvalid,
}: {
  template: AgentTemplate;
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  nameInvalid: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold tracking-tight">Como vamos chamar?</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Nome e descrição aparecem na sua lista de agentes. Não influenciam o
          comportamento — só ajudam você a identificar.
        </p>
      </div>

      {template.slug !== "blank" ? (
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-3 flex items-start gap-2 text-xs">
            <Sparkles className="size-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              Modelo escolhido:{" "}
              <strong className="text-foreground">{template.label}</strong>.
              Sugestão de descrição abaixo — ajuste se quiser.
            </p>
          </CardContent>
        </Card>
      ) : null}

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
          placeholder={template.short_description}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Lembrete pra você do que esse agente faz.
        </p>
      </div>
    </div>
  );
}

function Step3Model({
  template,
  name,
  description,
  model,
  onModelChange,
}: {
  template: AgentTemplate;
  name: string;
  description: string;
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
          Qual nível de IA vai responder pelas conversas. Você pode trocar depois
          em Regras.
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
              {name || (
                <span className="italic text-muted-foreground/60">vazio</span>
              )}
            </dd>
            <dt className="text-muted-foreground">Tipo de atendimento</dt>
            <dd className="font-medium text-foreground">{template.label}</dd>
            <dt className="text-muted-foreground">Fluxo</dt>
            <dd className="font-medium text-foreground">
              {template.slug === "blank"
                ? "Vazio — você monta no canvas"
                : "Pré-montado — você revisa antes de ativar"}
            </dd>
            <dt className="text-muted-foreground">IA</dt>
            <dd className="font-medium text-foreground">
              {selectedModel.label}
            </dd>
            {description ? (
              <>
                <dt className="text-muted-foreground">Descrição</dt>
                <dd className="text-muted-foreground line-clamp-2">
                  {description}
                </dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
