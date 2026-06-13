"use client";

// Editor estruturado de prompt SDR — migration 124.
//
// Substitui o textarea corrido (PromptBuilderSection) por 4 seções visuais:
//   1. Cadastro de Informações — identidade do agente (6 campos)
//   2. Tom de Comunicação — 4 presets + instrução customizada
//   3. Prompt Mestre de Atendimento — instrução geral de comportamento
//   4. Regras Comerciais + Ações Proibidas
//
// Não salva autonomamente: chama onChange(patch) com system_prompt compilado
// + structured_prompt_config. O RulesTab decide quando persistir.

import * as React from "react";
import {
  Ban,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronUp,
  Globe,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Card, CardContent } from "@persia/ui/card";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { cn } from "@persia/ui/utils";
import type {
  StructuredPromptCommercialRule,
  StructuredPromptConfig,
  TonePreset,
} from "@persia/shared/ai-agent";
import {
  compileStructuredPrompt,
  makeEmptyStructuredPromptConfig,
  TONE_PRESET_INSTRUCTIONS,
  TONE_PRESET_LABELS,
} from "@persia/shared/ai-agent";

// ─── Tipos locais ─────────────────────────────────────────────────────────────

interface Props {
  value: StructuredPromptConfig | null;
  onChange: (next: StructuredPromptConfig, compiledPrompt: string) => void;
}

// ─── Dados dos presets de tom ─────────────────────────────────────────────────

const TONE_PRESETS: Array<{
  preset: TonePreset;
  subtitle: string;
  badge?: string;
}> = [
  {
    preset: "direct_commercial",
    subtitle: "Focado em conversões imediatas.",
    badge: "Padrão",
  },
  {
    preset: "consultive_empathic",
    subtitle: "Ideal para produtos complexos ou alta sensibilidade.",
  },
  {
    preset: "formal_institutional",
    subtitle: "Excelente para B2B tradicional e marcas consolidadas.",
  },
  {
    preset: "casual_youth",
    subtitle: "Perfeito para e-commerce ou público jovem.",
  },
];

// ─── Utilitário ───────────────────────────────────────────────────────────────

function nanoid8(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Subcomponente: Seção colapsável ─────────────────────────────────────────

function Section({
  icon,
  title,
  subtitle,
  accent,
  defaultOpen = true,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <span className={cn("mt-0.5 shrink-0", accent ?? "text-primary")}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-5 pt-1 border-t border-border/60 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function StructuredPromptEditor({ value, onChange }: Props) {
  const [cfg, setCfg] = React.useState<StructuredPromptConfig>(
    value ?? makeEmptyStructuredPromptConfig(),
  );

  // Estado local da regra em edição
  const [editingRule, setEditingRule] =
    React.useState<StructuredPromptCommercialRule | null>(null);
  const [ruleTitle, setRuleTitle] = React.useState("");
  const [ruleProfile, setRuleProfile] = React.useState("");
  const [ruleDescription, setRuleDescription] = React.useState("");

  // Estado local da ação proibida sendo digitada
  const [prohibitedInput, setProhibitedInput] = React.useState("");

  // Propaga mudança para cima compilando o prompt
  const propagate = React.useCallback(
    (next: StructuredPromptConfig) => {
      setCfg(next);
      onChange(next, compileStructuredPrompt(next));
    },
    [onChange],
  );

  // ── Helpers de atualização parcial ────────────────────────────────────────

  function patchIdentity(patch: Partial<StructuredPromptConfig["identity"]>) {
    propagate({ ...cfg, identity: { ...cfg.identity, ...patch } });
  }

  function patchTone(patch: Partial<StructuredPromptConfig["tone"]>) {
    propagate({ ...cfg, tone: { ...cfg.tone, ...patch } });
  }

  function selectPreset(preset: TonePreset) {
    // Ao selecionar preset, limpa instrução customizada (usa o texto canônico).
    propagate({
      ...cfg,
      tone: { preset, custom_instruction: "" },
    });
  }

  // ── Regras comerciais ──────────────────────────────────────────────────────

  function openNewRule() {
    setEditingRule(null);
    setRuleTitle("");
    setRuleProfile("");
    setRuleDescription("");
  }

  function openEditRule(rule: StructuredPromptCommercialRule) {
    setEditingRule(rule);
    setRuleTitle(rule.title);
    setRuleProfile(rule.profile_label);
    setRuleDescription(rule.description);
  }

  function cancelRule() {
    setEditingRule(null);
    setRuleTitle("");
    setRuleProfile("");
    setRuleDescription("");
  }

  function saveRule() {
    if (!ruleTitle.trim()) return;
    const rule: StructuredPromptCommercialRule = {
      id: editingRule?.id ?? nanoid8(),
      title: ruleTitle.trim(),
      profile_label: ruleProfile.trim(),
      description: ruleDescription.trim(),
    };
    const existingIndex = cfg.commercial_rules.findIndex(
      (r) => r.id === rule.id,
    );
    const next =
      existingIndex >= 0
        ? cfg.commercial_rules.map((r, i) => (i === existingIndex ? rule : r))
        : [...cfg.commercial_rules, rule];
    propagate({ ...cfg, commercial_rules: next });
    cancelRule();
  }

  function deleteRule(id: string) {
    propagate({
      ...cfg,
      commercial_rules: cfg.commercial_rules.filter((r) => r.id !== id),
    });
  }

  // ── Ações proibidas ────────────────────────────────────────────────────────

  function addProhibited() {
    const text = prohibitedInput.trim();
    if (!text) return;
    propagate({
      ...cfg,
      prohibited_actions: [...cfg.prohibited_actions, text],
    });
    setProhibitedInput("");
  }

  function removeProhibited(index: number) {
    propagate({
      ...cfg,
      prohibited_actions: cfg.prohibited_actions.filter((_, i) => i !== index),
    });
  }

  const isEditingInlineRule =
    editingRule !== null ||
    (ruleTitle !== "" && editingRule === null && ruleTitle.length > 0);
  const inlineFormOpen =
    (editingRule !== null || ruleTitle !== "" || ruleDescription !== "") &&
    !(editingRule === null && ruleTitle === "" && ruleDescription === "");

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* ── 1. Cadastro de Informações ────────────────────────────────────── */}
      <Section
        icon={<User className="size-4" />}
        title="Cadastro de Informações"
        subtitle="Insira as informações de identidade do seu Agente SDR."
        accent="text-primary"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium">
              <User className="size-3 text-muted-foreground" />
              Nome do Agente
            </Label>
            <Input
              placeholder="Ex: Jordan Moura"
              value={cfg.identity.agent_name}
              onChange={(e) => patchIdentity({ agent_name: e.target.value })}
              name="sdr-agent-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium">
              <Building2 className="size-3 text-muted-foreground" />
              Empresa
            </Label>
            <Input
              placeholder="Ex: Humana Saúde"
              value={cfg.identity.company}
              onChange={(e) => patchIdentity({ company: e.target.value })}
              name="sdr-company"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium">
              <Globe className="size-3 text-muted-foreground" />
              Segmento de Atuação
            </Label>
            <Input
              placeholder="Ex: Planos de saúde"
              value={cfg.identity.segment}
              onChange={(e) => patchIdentity({ segment: e.target.value })}
              name="sdr-segment"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium">
              <MessageSquare className="size-3 text-muted-foreground" />
              Canal Principal
            </Label>
            <Input
              placeholder="Ex: WhatsApp"
              value={cfg.identity.channel}
              onChange={(e) => patchIdentity({ channel: e.target.value })}
              name="sdr-channel"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium">
              <MapPin className="size-3 text-muted-foreground" />
              Região Geográfica / DDD
            </Label>
            <Input
              placeholder="Ex: PI / Nordeste"
              value={cfg.identity.region}
              onChange={(e) => patchIdentity({ region: e.target.value })}
              name="sdr-region"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium">
              <Target className="size-3 text-muted-foreground" />
              Objetivo de Conversão
            </Label>
            <Input
              placeholder="Ex: Conduzir o lead até a contratação"
              value={cfg.identity.goal}
              onChange={(e) => patchIdentity({ goal: e.target.value })}
              name="sdr-goal"
            />
          </div>
        </div>
      </Section>

      {/* ── 2. Tom de Comunicação ─────────────────────────────────────────── */}
      <Section
        icon={<Sparkles className="size-4" />}
        title="Tom de Comunicação"
        subtitle="Como o agente deve modular a linguagem, estilo, regras de gramática e abordagens."
        accent="text-primary"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {TONE_PRESETS.map(({ preset, subtitle, badge }) => {
            const selected = cfg.tone.preset === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => selectPreset(preset)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-all",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-card hover:border-primary/40 hover:bg-muted/30",
                )}
              >
                <div className="flex items-start justify-between gap-1 mb-1.5">
                  <p className="text-xs font-semibold text-foreground leading-snug">
                    {TONE_PRESET_LABELS[preset]}
                  </p>
                  {badge && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {badge}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {TONE_PRESET_INSTRUCTIONS[preset]}
                </p>
                <p className="mt-1.5 text-[10px] font-medium text-primary/70 uppercase tracking-wide">
                  {subtitle}
                </p>
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Instrução de Tom Customizada</Label>
          <Textarea
            placeholder="Ex: Curta, humana, direta, educada e comercial. Fazer apenas uma pergunta por mensagem."
            value={
              cfg.tone.custom_instruction ||
              TONE_PRESET_INSTRUCTIONS[cfg.tone.preset]
            }
            onChange={(e) => patchTone({ custom_instruction: e.target.value })}
            rows={2}
            name="sdr-tone-custom"
          />
          <p className="text-[11px] text-muted-foreground">
            Deixe em branco para usar o texto padrão do preset selecionado.
          </p>
        </div>
      </Section>

      {/* ── 3. Prompt Mestre de Atendimento ───────────────────────────────── */}
      <Section
        icon={<BookOpen className="size-4" />}
        title="Prompt Mestre de Atendimento"
        subtitle="As regras estruturais primárias e regras comportamentais invioláveis do SDR."
        accent="text-primary"
      >
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Instruções gerais de comportamento
          </Label>
          <Textarea
            placeholder={`Você é um agente SDR comercial.\n\nSua função é conduzir o lead pelo fluxo de qualificação, identificar dados importantes, consultar fontes estruturadas quando necessário e responder de forma clara, curta e humana.\n\nRegras principais:\n- Responda em uma única mensagem.\n- Faça apenas uma pergunta por vez.\n- Nunca invente preços, prazos, condições ou informações.\n- Consulte as fontes cadastradas antes de responder dados comerciais.\n- Avance uma etapa por vez.\n- Não diga que é IA, robô ou automação.\n- Não peça documentos antes de sinal claro de compra.\n\nVocê representa {{company}} como {{agent_name}} via {{channel}}.`}
            value={cfg.master_prompt}
            onChange={(e) =>
              propagate({ ...cfg, master_prompt: e.target.value })
            }
            rows={10}
            name="sdr-master-prompt"
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {["{{agent_name}}", "{{company}}", "{{channel}}"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() =>
                  propagate({
                    ...cfg,
                    master_prompt: cfg.master_prompt + v,
                  })
                }
                className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 4. Regras Comerciais + Ações Proibidas ────────────────────────── */}
      <Section
        icon={<Zap className="size-4" />}
        title="Regras Comerciais"
        subtitle="Defina o comportamento do agente para diferentes perfis e as ações restritas."
        accent="text-warning"
      >
        {/* Cards de regras existentes */}
        {cfg.commercial_rules.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {cfg.commercial_rules.map((rule) => (
              <Card key={rule.id} className="relative group">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-foreground leading-snug">
                      {rule.title}
                    </p>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEditRule(rule)}
                        aria-label="Editar regra"
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => deleteRule(rule.id)}
                        aria-label="Excluir regra"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3">
                    {rule.description}
                  </p>
                  {rule.profile_label && (
                    <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      Aplica-se a {rule.profile_label}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Formulário inline de nova/edição de regra */}
        {inlineFormOpen ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground">
              {editingRule ? "Editar regra" : "Nova regra comercial"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Título da Regra</Label>
                <Input
                  placeholder="Ex: Regra Pessoa Física (PF)"
                  value={ruleTitle}
                  onChange={(e) => setRuleTitle(e.target.value)}
                  name="rule-title"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Perfil / Segmento (opcional)</Label>
                <Input
                  placeholder="Ex: Pessoa Física (PF)"
                  value={ruleProfile}
                  onChange={(e) => setRuleProfile(e.target.value)}
                  name="rule-profile"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição da Regra</Label>
              <Textarea
                placeholder="Ex: Pessoa Física usa tabelas PF. Se for adulto PF, perguntar sobre obstetrícia antes da cotação."
                value={ruleDescription}
                onChange={(e) => setRuleDescription(e.target.value)}
                rows={3}
                name="rule-description"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelRule}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={saveRule}
                disabled={!ruleTitle.trim()}
              >
                {editingRule ? "Salvar alterações" : "Adicionar regra"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openNewRule}
            className="w-full border-dashed"
          >
            <Plus className="size-3.5" data-icon="inline-start" />
            Adicionar regra comercial
          </Button>
        )}

        {/* Ações Proibidas */}
        <div className="mt-2 space-y-3">
          <div className="flex items-center gap-2">
            <Ban className="size-4 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Ações Proibidas e Restrições de IA
              </p>
              <p className="text-xs text-muted-foreground">
                Diretrizes severas com o que o agente NUNCA deve fazer ou falar sob hipótese alguma.
              </p>
            </div>
          </div>

          {/* Tags de ações já adicionadas */}
          {cfg.prohibited_actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {cfg.prohibited_actions.map((action, idx) => (
                <span
                  key={idx}
                  className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive"
                >
                  {action}
                  <button
                    type="button"
                    onClick={() => removeProhibited(idx)}
                    aria-label="Remover"
                    className="hover:text-destructive/70 transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Input de nova ação proibida */}
          <div className="flex gap-2">
            <Input
              placeholder='Digite uma ação proibida (ex: Dizer dados de concorrentes) e tecle Enter...'
              value={prohibitedInput}
              onChange={(e) => setProhibitedInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addProhibited();
                }
              }}
              name="prohibited-action-input"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addProhibited}
              disabled={!prohibitedInput.trim()}
              className="shrink-0 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
            >
              <Plus className="size-3.5" />
              Adicionar
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
