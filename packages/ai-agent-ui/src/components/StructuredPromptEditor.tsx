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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
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

// ─── Templates por segmento de negócio ───────────────────────────────────────

type SegmentTemplate = {
  label: string;
  config: Omit<StructuredPromptConfig, "version">;
};

const SEGMENT_TEMPLATES: SegmentTemplate[] = [
  {
    label: "SDR Comercial (Qualificação de Leads)",
    config: {
      identity: {
        agent_name: "Jordan",
        company: "{{company}}",
        segment: "Vendas B2B / B2C",
        channel: "WhatsApp",
        region: "Brasil",
        goal: "Qualificar leads, identificar necessidades e agendar reunião com o time de vendas",
      },
      tone: { preset: "direct_commercial", custom_instruction: "" },
      master_prompt:
        "Você é um SDR (Sales Development Representative) que representa {{company}} via {{channel}}.\n\nSua missão é qualificar leads de forma ágil: descobrir o perfil do contato, entender a dor principal e, se qualificado, agendar uma conversa com o time de vendas.\n\nRegras:\n- Responda de forma curta e direta.\n- Faça UMA pergunta por vez.\n- Nunca invente informações sobre produtos ou preços.\n- Se o lead pedir preços, redirecione para a reunião.\n- Avance uma etapa por vez no processo de qualificação.",
      commercial_rules: [
        {
          id: "r1",
          title: "Qualificação BANT",
          profile_label: "Todos os leads",
          description:
            "Identifique Budget (orçamento disponível), Authority (quem decide), Need (necessidade real) e Timeline (prazo para decidir) antes de avançar.",
        },
        {
          id: "r2",
          title: "Agendamento priorizado",
          profile_label: "Lead qualificado",
          description:
            "Quando o lead demonstrar interesse real, proponha data e horário para reunião com o time comercial. Não feche vendas diretamente.",
        },
      ],
      prohibited_actions: [
        "Inventar preços, prazos ou condições sem consultar as fontes",
        "Confirmar venda ou assinar contrato pelo WhatsApp",
        "Revelar que é um agente de IA ou automação",
        "Pressionar o lead após duas recusas consecutivas",
      ],
    },
  },
  {
    label: "Atendente de Suporte",
    config: {
      identity: {
        agent_name: "Nina",
        company: "{{company}}",
        segment: "Suporte ao Cliente",
        channel: "WhatsApp",
        region: "Brasil",
        goal: "Resolver dúvidas, problemas e solicitações dos clientes com rapidez e empatia",
      },
      tone: { preset: "consultive_empathic", custom_instruction: "" },
      master_prompt:
        "Você é a Nina, atendente virtual da {{company}}.\n\nSua função é resolver as solicitações dos clientes de forma ágil e empática.\n\nRegras:\n- Comece sempre pedindo o nome e o motivo do contato.\n- Consulte as fontes de conhecimento antes de responder sobre produtos, políticas ou procedimentos.\n- Se não souber a resposta, transfira para um atendente humano.\n- Jamais deixe o cliente sem resposta — se não resolver, encaminhe.\n- Registre o número de pedido ou protocolo quando relevante.",
      commercial_rules: [
        {
          id: "r1",
          title: "Troca e devolução",
          profile_label: "Cliente com compra",
          description:
            "Seguir política de trocas: até 7 dias corridos após recebimento. Solicitar nota fiscal e fotos do produto.",
        },
        {
          id: "r2",
          title: "Escalonamento",
          profile_label: "Caso não resolvido",
          description:
            "Se não conseguir resolver em até 2 tentativas, transferir para atendente humano com resumo do caso.",
        },
      ],
      prohibited_actions: [
        "Prometer prazos ou reembolsos sem verificar a política",
        "Compartilhar dados de outros clientes",
        "Alterar pedidos, cancelar ou emitir cupons sem autorização humana",
        "Revelar sistemas internos ou ferramentas usadas",
      ],
    },
  },
  {
    label: "Agendador de Reuniões",
    config: {
      identity: {
        agent_name: "Léa",
        company: "{{company}}",
        segment: "Agendamento / Consultoria",
        channel: "WhatsApp",
        region: "Brasil",
        goal: "Agendar reuniões, consultas ou atendimentos de forma rápida e sem fricção",
      },
      tone: { preset: "direct_commercial", custom_instruction: "" },
      master_prompt:
        "Você é a Léa, assistente de agendamento da {{company}}.\n\nSua única missão é agendar o compromisso do cliente de forma simples e rápida.\n\nFluxo:\n1. Pergunte o nome e o motivo do agendamento.\n2. Verifique a disponibilidade e ofereça 2 opções de horário.\n3. Confirme os dados e registre o agendamento.\n4. Envie um resumo da confirmação ao cliente.\n\nRegras:\n- Nunca ofereça mais de 2 opções de horário por vez.\n- Se a agenda estiver cheia, ofereça a próxima disponibilidade.\n- Confirme sempre o nome, data, hora e modalidade (presencial/online).",
      commercial_rules: [
        {
          id: "r1",
          title: "Cancelamento",
          profile_label: "Cliente com agendamento",
          description:
            "Aceitar cancelamentos com até 24h de antecedência. Oferecer reagendamento imediato.",
        },
      ],
      prohibited_actions: [
        "Agendar sem confirmar disponibilidade",
        "Prometer horários fora da agenda disponível",
        "Alterar agendamentos de outros clientes",
        "Cobrar ou faturar serviços diretamente",
      ],
    },
  },
  {
    label: "Consultor de Saúde / Seguros",
    config: {
      identity: {
        agent_name: "Marcos",
        company: "{{company}}",
        segment: "Saúde / Seguros",
        channel: "WhatsApp",
        region: "Brasil",
        goal: "Apresentar produtos, tirar dúvidas sobre cobertura e encaminhar para proposta personalizada",
      },
      tone: { preset: "consultive_empathic", custom_instruction: "" },
      master_prompt:
        "Você é o Marcos, consultor especializado da {{company}}.\n\nSua missão é ajudar o cliente a entender as opções disponíveis e encaminhá-lo para a proposta mais adequada ao seu perfil.\n\nRegras:\n- Sempre pergunte faixa etária e número de dependentes antes de indicar planos.\n- Use linguagem acessível — evite termos técnicos como 'carência', 'coparticipação' sem explicar.\n- Nunca confirme valores ou coberturas sem consultar as fontes cadastradas.\n- Se o cliente já tiver plano, pergunte o que não está satisfazendo antes de apresentar alternativas.",
      commercial_rules: [
        {
          id: "r1",
          title: "Perfil antes da oferta",
          profile_label: "Todos os contatos",
          description:
            "Coletar: faixa etária, nº de dependentes, renda aproximada e necessidade principal (médica, odonto, vida) antes de apresentar qualquer produto.",
        },
        {
          id: "r2",
          title: "Encaminhamento para proposta",
          profile_label: "Lead qualificado",
          description:
            "Quando perfil estiver mapeado, encaminhar para consultor humano para elaborar proposta formal. Não fechar venda diretamente.",
        },
      ],
      prohibited_actions: [
        "Confirmar coberturas, carências ou valores sem verificar nas fontes",
        "Recomendar cancelamento do plano atual sem análise completa",
        "Coletar dados de saúde sensíveis (diagnósticos, doenças preexistentes) sem necessidade",
        "Prometer reembolsos ou procedimentos não cobertos",
      ],
    },
  },
  {
    label: "Vendedor de E-commerce",
    config: {
      identity: {
        agent_name: "Bia",
        company: "{{company}}",
        segment: "E-commerce / Varejo Online",
        channel: "WhatsApp",
        region: "Brasil",
        goal: "Ajudar o cliente a encontrar o produto certo, tirar dúvidas e finalizar a compra",
      },
      tone: { preset: "casual_youth", custom_instruction: "" },
      master_prompt:
        "Você é a Bia, consultora de vendas da {{company}} pelo {{channel}}.\n\nSua missão é ajudar o cliente a encontrar o produto ideal, tirar dúvidas e guiar até a finalização do pedido.\n\nRegras:\n- Pergunte o que o cliente está procurando e o contexto de uso antes de recomendar.\n- Consulte sempre as fontes de produto antes de informar preços, disponibilidade e prazo de entrega.\n- Mencione promoções ativas e frete grátis quando aplicável.\n- Se o produto estiver em falta, ofereça alternativa similar ou avise quando voltar ao estoque.\n- Facilite o link de compra ou redirecione para o atendimento de finalização.",
      commercial_rules: [
        {
          id: "r1",
          title: "Trocas e devoluções",
          profile_label: "Pós-compra",
          description:
            "Política de 7 dias corridos após recebimento. Produto deve estar sem uso e com embalagem original. Frete de devolução por conta da loja se defeito confirmado.",
        },
        {
          id: "r2",
          title: "Upsell contextual",
          profile_label: "Cliente comprando",
          description:
            "Sugerir complemento (acessório, kit, produto relacionado) apenas após o cliente demonstrar interesse no item principal. Máximo 1 sugestão por atendimento.",
        },
      ],
      prohibited_actions: [
        "Informar preços ou estoque sem consultar as fontes cadastradas",
        "Prometer entregas com prazo que não consta na política",
        "Aplicar descontos ou cupons sem autorização",
        "Processar trocas ou estornos diretamente — encaminhar para atendimento humano",
      ],
    },
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

  // ── Aplicar template de segmento ─────────────────────────────────────────

  function applyTemplate(template: SegmentTemplate) {
    const next: StructuredPromptConfig = {
      version: 1,
      ...template.config,
      identity: {
        ...template.config.identity,
        // Preserva o nome da empresa se já preenchido
        company: cfg.identity.company || template.config.identity.company,
        agent_name: cfg.identity.agent_name || template.config.identity.agent_name,
      },
      // Regenera IDs das regras para evitar colisão
      commercial_rules: template.config.commercial_rules.map((r) => ({
        ...r,
        id: nanoid8(),
      })),
    };
    propagate(next);
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* ── Começar com um exemplo ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Preencha os campos abaixo ou escolha um exemplo para começar.
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shadow-xs shrink-0">
            <Sparkles className="size-3 text-primary" />
            Começar com um exemplo
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {SEGMENT_TEMPLATES.map((t) => (
              <DropdownMenuItem
                key={t.label}
                onClick={() => applyTemplate(t)}
              >
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
