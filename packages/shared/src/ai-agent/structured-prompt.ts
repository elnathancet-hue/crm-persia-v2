// AI Agent — compilador do editor estruturado de prompt SDR (migration 124).
//
// compileStructuredPrompt() converte StructuredPromptConfig → system_prompt
// (string) que o executor usa. A UI chama essa função ao salvar o agente.
//
// Decisões de design:
//   - Seções geradas na mesma ordem que aparecem na UI.
//   - Variáveis {{agent_name}}, {{company}}, {{channel}} no master_prompt
//     são responsabilidade do caller interpolá-las em runtime. Aqui apenas
//     a string é montada — não há substituição de variáveis.
//   - Seções vazias são omitidas silenciosamente (não geram headers órfãos).
//   - TonePreset → instrução canônica. Se custom_instruction estiver
//     preenchido, usa ele; senão usa o texto do preset.

import type {
  StructuredPromptConfig,
  StructuredPromptCommercialRule,
  TonePreset,
} from "./types";

// Textos canônicos de cada preset (exibidos na UI e injetados no prompt).
export const TONE_PRESET_LABELS: Record<TonePreset, string> = {
  direct_commercial: "Direto & Comercial",
  consultive_empathic: "Consultivo & Empático",
  formal_institutional: "Formal & Institucional",
  casual_youth: "Casual & Jovem",
};

export const TONE_PRESET_INSTRUCTIONS: Record<TonePreset, string> = {
  direct_commercial:
    "Curta, humana, direta, educada e comercial. Fazer apenas uma pergunta por mensagem. Focado em conversões imediatas.",
  consultive_empathic:
    "Amigável, atencioso, empático e informativo. Mostrar interesse genuíno e fazer perguntas. Ideal para produtos complexos ou alta sensibilidade.",
  formal_institutional:
    "Linguagem polida, séria, profissional e sem gírias. Utilizar vocabulário corporativo. Excelente para B2B tradicional e marcas consolidadas.",
  casual_youth:
    "Descontraído, ágil, uso sutil de emojis, abreviações educadas e vocabulário amigável. Perfeito para e-commerce ou público jovem.",
};

export function compileStructuredPrompt(config: StructuredPromptConfig): string {
  const parts: string[] = [];

  // ── Bloco 1: Identidade ──────────────────────────────────────────────────
  const { identity } = config;
  const identityLines: string[] = [];

  if (identity.agent_name && identity.company) {
    identityLines.push(
      `Você é ${identity.agent_name}, representante da ${identity.company}.`,
    );
  } else if (identity.agent_name) {
    identityLines.push(`Você é ${identity.agent_name}.`);
  } else if (identity.company) {
    identityLines.push(`Você representa a ${identity.company}.`);
  }

  if (identity.segment) {
    identityLines.push(`Segmento de atuação: ${identity.segment}.`);
  }
  if (identity.channel) {
    identityLines.push(`Canal principal: ${identity.channel}.`);
  }
  if (identity.region) {
    identityLines.push(`Região de atendimento: ${identity.region}.`);
  }
  if (identity.goal) {
    identityLines.push(`Objetivo: ${identity.goal}.`);
  }

  if (identityLines.length > 0) {
    parts.push(identityLines.join("\n"));
  }

  // ── Bloco 2: Tom de comunicação ──────────────────────────────────────────
  const toneInstruction =
    config.tone.custom_instruction.trim() ||
    TONE_PRESET_INSTRUCTIONS[config.tone.preset];

  if (toneInstruction) {
    parts.push(`## Tom de comunicação\n${toneInstruction}`);
  }

  // ── Bloco 3: Instruções gerais de comportamento ──────────────────────────
  if (config.master_prompt.trim()) {
    parts.push(
      `## Instruções gerais de comportamento\n${config.master_prompt.trim()}`,
    );
  }

  // ── Bloco 4: Regras comerciais ───────────────────────────────────────────
  if (config.commercial_rules.length > 0) {
    const rulesBlock = config.commercial_rules
      .map((r: StructuredPromptCommercialRule) => {
        const header = r.profile_label
          ? `### ${r.title} (${r.profile_label})`
          : `### ${r.title}`;
        return `${header}\n${r.description.trim()}`;
      })
      .join("\n\n");
    parts.push(`## Regras comerciais\n${rulesBlock}`);
  }

  // ── Bloco 5: Ações proibidas ─────────────────────────────────────────────
  const prohibited = config.prohibited_actions.filter((a) => a.trim());
  if (prohibited.length > 0) {
    const list = prohibited.map((a) => `- ${a}`).join("\n");
    parts.push(`## Ações proibidas — NUNCA faça isso sob hipótese alguma\n${list}`);
  }

  return parts.join("\n\n");
}

export function makeEmptyStructuredPromptConfig(): StructuredPromptConfig {
  return {
    version: 1,
    identity: {
      agent_name: "",
      company: "",
      segment: "",
      channel: "WhatsApp",
      region: "",
      goal: "",
    },
    tone: {
      preset: "direct_commercial",
      custom_instruction: "",
    },
    master_prompt: "",
    commercial_rules: [],
    prohibited_actions: [],
  };
}
