// AI Agent — validador de resposta antes do envio (Migration 101).
//
// Função pura: recebe texto + config, retorna resultado.
// Sem efeitos colaterais — runner.ts decide o que fazer com o resultado.

import type { ValidationConfig } from "@persia/shared/ai-agent";

export interface ValidationResult {
  approved: boolean;
  /** Lista de motivos de bloqueio. Vazio quando approved=true. */
  reasons: string[];
  /** Ação configurada (cópia de config.on_block). null quando approved=true. */
  action: ValidationConfig["on_block"] | null;
}

/**
 * Valida uma resposta gerada pela IA contra as regras configuradas.
 *
 * Regras aplicadas (em ordem):
 *   1. block_empty_response — bloqueia se texto vazio após trim
 *   2. max_chars           — bloqueia se length > max_chars (0 = sem limite)
 *   3. one_question_only   — bloqueia se mais de 1 interrogação "?"
 *   4. forbidden_phrases   — bloqueia se texto contém alguma frase (case-insensitive)
 *   5. blocked_promises    — idem, mas semântica de "promessa proibida"
 *
 * Se validation_config.enabled=false, retorna approved=true imediatamente.
 */
export function validateAgentResponse(
  text: string,
  config: ValidationConfig,
): ValidationResult {
  if (!config.enabled) {
    return { approved: true, reasons: [], action: null };
  }

  const reasons: string[] = [];

  // 1. Resposta vazia
  if (config.block_empty_response && !text.trim()) {
    reasons.push("empty_response");
  }

  // 2. Tamanho máximo
  if (config.max_chars > 0 && text.length > config.max_chars) {
    reasons.push(`too_long:${text.length}>${config.max_chars}`);
  }

  // 3. Múltiplas perguntas
  if (config.one_question_only) {
    const count = (text.match(/\?/g) ?? []).length;
    if (count > 1) {
      reasons.push(`multiple_questions:${count}`);
    }
  }

  const lower = text.toLowerCase();

  // 4. Frases proibidas
  for (const phrase of config.forbidden_phrases) {
    const normalized = phrase.toLowerCase().trim();
    if (normalized && lower.includes(normalized)) {
      reasons.push(`forbidden_phrase:${phrase}`);
    }
  }

  // 5. Promessas proibidas
  for (const promise of config.blocked_promises) {
    const normalized = promise.toLowerCase().trim();
    if (normalized && lower.includes(normalized)) {
      reasons.push(`blocked_promise:${promise}`);
    }
  }

  if (reasons.length === 0) {
    return { approved: true, reasons: [], action: null };
  }

  return { approved: false, reasons, action: config.on_block };
}
