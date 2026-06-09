// AI Agent — ValidationConfig: valida a resposta gerada antes do envio.
//
// Migration 101: coluna validation_config JSONB em agent_configs.
//
// Camada de segurança simples entre a geração da IA e o envio pro
// WhatsApp. Nenhuma arquitetura nova — só regras de texto + ação corretiva.
//
// Compatibilidade: se validation_config não existir ou enabled=false,
// normalizeValidationConfig retorna defaults desativados e o runtime
// passa direto (comportamento atual preservado).

export type ValidationOnBlock = "rewrite" | "fallback" | "pause_ai" | "alert_only";

export interface ValidationConfig {
  /** Ativar validação. false = bypass total — comportamento atual. */
  enabled: boolean;
  /** Tamanho máximo em chars. 0 = sem limite. */
  max_chars: number;
  /** Bloquear mensagens com mais de 1 interrogação. */
  one_question_only: boolean;
  /** Bloquear resposta vazia (trim = ""). */
  block_empty_response: boolean;
  /** Termos proibidos (case-insensitive). Ex: "vou transferir pra...". */
  forbidden_phrases: string[];
  /** Promessas que o agente não pode fazer. Ex: "vou ligar pra você". */
  blocked_promises: string[];
  /** O que fazer quando alguma regra bloqueia:
   *   rewrite    → pede reescrita à IA; se falhar, usa fallback_message
   *   fallback   → substitui pela fallback_message diretamente
   *   pause_ai   → pausa o agente; não envia nada
   *   alert_only → envia mesmo assim mas registra o alerta
   */
  on_block: ValidationOnBlock;
  /** Mensagem usada em on_block="fallback" e como safety-net quando
   *  on_block="rewrite" falha segunda validação. */
  fallback_message: string;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = Object.freeze({
  enabled: false,
  max_chars: 0,
  one_question_only: false,
  block_empty_response: true,
  forbidden_phrases: [],
  blocked_promises: [],
  on_block: "alert_only",
  fallback_message: "",
});

const MAX_CHARS_LIMIT = 4000;
const MAX_FALLBACK_LEN = 1000;
const MAX_PHRASE_LEN = 200;
const MAX_PHRASES = 50;

/**
 * Normaliza validation_config lido do JSONB. Sempre retorna shape válido.
 * Valores ausentes ou inválidos caem para os defaults.
 */
export function normalizeValidationConfig(raw: unknown): ValidationConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_VALIDATION_CONFIG };
  }
  const obj = raw as Record<string, unknown>;

  const enabled = obj.enabled === true;

  const max_chars =
    typeof obj.max_chars === "number" &&
    Number.isFinite(obj.max_chars) &&
    obj.max_chars >= 0
      ? Math.min(Math.floor(obj.max_chars), MAX_CHARS_LIMIT)
      : DEFAULT_VALIDATION_CONFIG.max_chars;

  const one_question_only = obj.one_question_only === true;

  // block_empty_response default=true — só desativa se explicitamente false
  const block_empty_response = obj.block_empty_response !== false;

  const VALID_ON_BLOCK: readonly string[] = [
    "rewrite",
    "fallback",
    "pause_ai",
    "alert_only",
  ];
  const on_block: ValidationOnBlock = VALID_ON_BLOCK.includes(
    obj.on_block as string,
  )
    ? (obj.on_block as ValidationOnBlock)
    : DEFAULT_VALIDATION_CONFIG.on_block;

  const fallback_message =
    typeof obj.fallback_message === "string"
      ? obj.fallback_message.slice(0, MAX_FALLBACK_LEN)
      : "";

  const normPhrases = (list: unknown): string[] => {
    if (!Array.isArray(list)) return [];
    return list
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map((p) => p.trim().slice(0, MAX_PHRASE_LEN))
      .slice(0, MAX_PHRASES);
  };

  return {
    enabled,
    max_chars,
    one_question_only,
    block_empty_response,
    forbidden_phrases: normPhrases(obj.forbidden_phrases),
    blocked_promises: normPhrases(obj.blocked_promises),
    on_block,
    fallback_message,
  };
}
