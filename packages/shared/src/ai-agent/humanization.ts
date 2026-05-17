// AI Agent — humanization config. Settings que fazem a IA parecer SDR
// humano. Centralizado num JSONB (`agent_configs.humanization_config`)
// que cresce a cada PR:
//   PR A (atual): pause/resume keywords + auto_pause_minutes
//   PR B (proximo): split_enabled, split_threshold, split_delay_seconds
//   PR C (proximo): business_hours + after_hours_message
//   PR D (proximo): nada — D mexe em tools/, nao aqui
//
// Runtime SEMPRE normaliza via `normalizeHumanizationConfig` antes de
// usar — assim rows criados antes da migration 041 ou JSONB com chaves
// faltando funcionam com defaults.

export const AUTO_PAUSE_MINUTES_DEFAULT = 30;
export const AUTO_PAUSE_MINUTES_MIN = 0; // 0 = nao auto-pausa
export const AUTO_PAUSE_MINUTES_MAX = 1440; // 24h

export const PAUSE_KEYWORDS_DEFAULT: ReadonlyArray<string> = [
  "PAUSAR",
  "HUMANO",
  "STOP IA",
];

export const RESUME_KEYWORDS_DEFAULT: ReadonlyArray<string> = [
  "ATIVAR",
  "IA ON",
  "VOLTAR IA",
];

// PR B (mai/2026): split de respostas longas pra parecer mais humano.
// Quando split_enabled = true E reply >= threshold_chars, executor pede
// ao GPT pra cortar em N mensagens curtas (lib/ai/message-splitter) e
// envia uma por vez com setTyping + delay entre elas. Default off por
// conservadorismo — split usa 1 chamada OpenAI extra (~$0.0001 por
// resposta longa, mas o cliente paga plano fixo).
export const SPLIT_ENABLED_DEFAULT = false;
export const SPLIT_THRESHOLD_CHARS_DEFAULT = 200;
export const SPLIT_THRESHOLD_CHARS_MIN = 50;
export const SPLIT_THRESHOLD_CHARS_MAX = 1000;
export const SPLIT_DELAY_SECONDS_DEFAULT = 2;
export const SPLIT_DELAY_SECONDS_MIN = 0;
export const SPLIT_DELAY_SECONDS_MAX = 30;

export interface HumanizationConfig {
  /**
   * Palavras-chave (case-insensitive, match exato apos uppercase + trim)
   * que o LEAD pode mandar pra pausar a IA. Quando match, IA fica em
   * modo silencioso (`agent_conversations.human_handoff_at` setado) e
   * nao responde ate o resume.
   */
  pause_keywords: string[];

  /**
   * Palavras-chave (case-insensitive) que o LEAD pode mandar pra reativar
   * a IA depois de pausa. Limpa `human_handoff_at` e continua respondendo
   * normalmente a partir da proxima mensagem.
   */
  resume_keywords: string[];

  /**
   * Quantos minutos a IA fica pausada quando humano (operator) responde
   * manualmente pelo CRM. 0 = nunca auto-pausa (humano nao trava IA).
   * Apos esse periodo, proxima msg do lead reativa automaticamente.
   * Range [AUTO_PAUSE_MINUTES_MIN, AUTO_PAUSE_MINUTES_MAX].
   */
  auto_pause_minutes: number;

  /**
   * Quando true, respostas com >= split_threshold_chars sao quebradas em
   * varias mensagens WhatsApp menores via splitMessage (GPT decide os
   * cortes naturais). Quando false ou reply curto, envia inteira.
   */
  split_enabled: boolean;

  /**
   * Numero minimo de caracteres da resposta pra disparar split. Respostas
   * mais curtas vao inteiras mesmo com split_enabled = true.
   * Range [SPLIT_THRESHOLD_CHARS_MIN, SPLIT_THRESHOLD_CHARS_MAX].
   */
  split_threshold_chars: number;

  /**
   * Segundos de delay entre cada mensagem picada (com setTyping ativo).
   * Simula tempo de digitacao humano. 0 = sem delay (envia em sequencia
   * imediata). Range [SPLIT_DELAY_SECONDS_MIN, SPLIT_DELAY_SECONDS_MAX].
   */
  split_delay_seconds: number;
}

export function clampAutoPauseMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return AUTO_PAUSE_MINUTES_DEFAULT;
  }
  if (value < AUTO_PAUSE_MINUTES_MIN) return AUTO_PAUSE_MINUTES_MIN;
  if (value > AUTO_PAUSE_MINUTES_MAX) return AUTO_PAUSE_MINUTES_MAX;
  return Math.floor(value);
}

export function clampSplitThresholdChars(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return SPLIT_THRESHOLD_CHARS_DEFAULT;
  }
  if (value < SPLIT_THRESHOLD_CHARS_MIN) return SPLIT_THRESHOLD_CHARS_MIN;
  if (value > SPLIT_THRESHOLD_CHARS_MAX) return SPLIT_THRESHOLD_CHARS_MAX;
  return Math.floor(value);
}

export function clampSplitDelaySeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return SPLIT_DELAY_SECONDS_DEFAULT;
  }
  if (value < SPLIT_DELAY_SECONDS_MIN) return SPLIT_DELAY_SECONDS_MIN;
  if (value > SPLIT_DELAY_SECONDS_MAX) return SPLIT_DELAY_SECONDS_MAX;
  return Math.floor(value);
}

/**
 * Normaliza um keyword: uppercase + trim. Usado tanto pro setting
 * (quando salva) quanto pra comparacao (quando lead manda msg).
 * Match e por igualdade exata depois de normalizar — nao usa
 * includes/regex pra evitar false positives (lead falando "humano
 * preciso falar com" nao deve pausar).
 */
export function normalizeKeyword(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Filtra entradas vazias + normaliza + deduplica. Aplicado tanto na
 * UI (antes de salvar) quanto no runtime (pra defensive parse).
 */
export function sanitizeKeywordList(
  raw: ReadonlyArray<unknown> | undefined,
  fallback: ReadonlyArray<string>,
): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const cleaned = raw
    .filter((v): v is string => typeof v === "string")
    .map(normalizeKeyword)
    .filter((s) => s.length > 0);
  // dedup preservando ordem
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of cleaned) {
    if (!seen.has(kw)) {
      seen.add(kw);
      out.push(kw);
    }
  }
  return out.length > 0 ? out : [...fallback];
}

/**
 * Aplica defaults + valida shape do JSONB lido do DB. Sempre retorna
 * um objeto completo. Codigo runtime pode confiar nos campos sem
 * checar undefined.
 */
export function normalizeHumanizationConfig(
  raw: unknown,
): HumanizationConfig {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    pause_keywords: sanitizeKeywordList(
      obj.pause_keywords as ReadonlyArray<unknown> | undefined,
      PAUSE_KEYWORDS_DEFAULT,
    ),
    resume_keywords: sanitizeKeywordList(
      obj.resume_keywords as ReadonlyArray<unknown> | undefined,
      RESUME_KEYWORDS_DEFAULT,
    ),
    auto_pause_minutes: clampAutoPauseMinutes(obj.auto_pause_minutes),
    split_enabled:
      typeof obj.split_enabled === "boolean"
        ? obj.split_enabled
        : SPLIT_ENABLED_DEFAULT,
    split_threshold_chars: clampSplitThresholdChars(obj.split_threshold_chars),
    split_delay_seconds: clampSplitDelaySeconds(obj.split_delay_seconds),
  };
}

/**
 * True se a mensagem do lead bate exatamente com algum pause keyword
 * (depois de uppercase + trim). Usado no executor antes de processar.
 */
export function matchesPauseKeyword(
  text: string | null | undefined,
  config: HumanizationConfig,
): boolean {
  if (!text) return false;
  const normalized = normalizeKeyword(text);
  return config.pause_keywords.includes(normalized);
}

/**
 * True se a mensagem do lead bate com algum resume keyword. Quando a
 * conversa esta pausada (human_handoff_at != null) e o lead manda um
 * desses, IA reativa.
 */
export function matchesResumeKeyword(
  text: string | null | undefined,
  config: HumanizationConfig,
): boolean {
  if (!text) return false;
  const normalized = normalizeKeyword(text);
  return config.resume_keywords.includes(normalized);
}

/**
 * Calcula se uma pausa automatica ja expirou. Recebe o ISO timestamp
 * do `human_handoff_at` e o config. Se `auto_pause_minutes` for 0,
 * nunca expira (pausa permanente ate resume manual).
 */
export function isAutoPauseExpired(
  handoffAtIso: string | null | undefined,
  config: HumanizationConfig,
  now: Date = new Date(),
): boolean {
  if (!handoffAtIso) return false;
  if (config.auto_pause_minutes <= 0) return false;
  const handoffAt = new Date(handoffAtIso);
  if (Number.isNaN(handoffAt.getTime())) return false;
  const expiresAt = new Date(
    handoffAt.getTime() + config.auto_pause_minutes * 60_000,
  );
  return now >= expiresAt;
}
