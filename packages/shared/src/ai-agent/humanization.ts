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
// Quando split_enabled = true E reply >= threshold_chars, runtime corta
// em N mensagens curtas via chunking DETERMINISTICO (whitespace, sem
// custo) — `realtime-provider.ts::splitMessage`. Envia uma por vez com
// setTyping + delay entre elas. Default off por conservadorismo.
//
// Backlog #14 Auditoria (mai/2026): comentario antigo dizia que split
// usava GPT extra (~$0.0001 por resposta), mas a implementacao foi
// simplificada pra chunking deterministico pre-PR-FLOW-PIVOT — zero
// custo OpenAI. Atualizado pra refletir realidade.
export const SPLIT_ENABLED_DEFAULT = false;
export const SPLIT_THRESHOLD_CHARS_DEFAULT = 200;
export const SPLIT_THRESHOLD_CHARS_MIN = 50;
export const SPLIT_THRESHOLD_CHARS_MAX = 1000;
export const SPLIT_DELAY_SECONDS_DEFAULT = 2;
export const SPLIT_DELAY_SECONDS_MIN = 0;
export const SPLIT_DELAY_SECONDS_MAX = 30;

// PR C (mai/2026): horario comercial. Cliente brasileiro tipico atende
// seg-sex 9-18, sab-dom fechado. Default reflete isso. Fora do horario,
// agente envia after_hours_message (1x a cada AFTER_HOURS_COOLDOWN_HOURS
// pra nao spammar — controlado via agent_conversations.after_hours_notified_at).
//
// Timezone hardcoded na UI por enquanto (America/Sao_Paulo). Cliente
// em outra tz precisa SQL Editor pra mudar o JSONB diretamente. Se
// houver demanda, vira Select dropdown.

export const BUSINESS_HOURS_ENABLED_DEFAULT = false;
export const BUSINESS_HOURS_TIMEZONE_DEFAULT = "America/Sao_Paulo";
export const AFTER_HOURS_MESSAGE_DEFAULT =
  "Olá! Recebi sua mensagem. Estou fora do horário de atendimento agora — vou retornar assim que possível.";
export const AFTER_HOURS_MESSAGE_MAX_LENGTH = 500;
export const AFTER_HOURS_NOTIFICATION_COOLDOWN_HOURS = 6;

// Default true: o template HANDOFF_DEFAULT_TEMPLATE ja inclui {{summary}}
// historicamente. Cliente pode desligar pra notificacao enxuta sem GPT
// extra (economia de ~1 call por handoff).
export const HANDOFF_INCLUDE_SUMMARY_DEFAULT = true;

export const DAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type DayName = (typeof DAY_NAMES)[number];

export interface DayHours {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export type BusinessHours = Record<DayName, DayHours | null>;

const WEEKDAY_DEFAULT: DayHours = { start: "09:00", end: "18:00" };

export const BUSINESS_HOURS_DEFAULT: BusinessHours = {
  monday: WEEKDAY_DEFAULT,
  tuesday: WEEKDAY_DEFAULT,
  wednesday: WEEKDAY_DEFAULT,
  thursday: WEEKDAY_DEFAULT,
  friday: WEEKDAY_DEFAULT,
  saturday: null,
  sunday: null,
};

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

  /**
   * Quando true, agente nativo so responde dentro do horario configurado.
   * Fora do horario, manda after_hours_message (1x a cada
   * AFTER_HOURS_NOTIFICATION_COOLDOWN_HOURS — controle via
   * agent_conversations.after_hours_notified_at).
   */
  business_hours_enabled: boolean;

  /**
   * IANA timezone (ex: "America/Sao_Paulo"). Define o "horario local"
   * usado pra checar se a msg do lead caiu dentro/fora da janela.
   * Default e Brasil/Sao Paulo — UI nao expoe Select pra outras tz
   * (admin edita via SQL se precisar).
   */
  business_hours_timezone: string;

  /**
   * Janelas por dia da semana. null = fechado (nao atende). Cada dia
   * tem uma unica faixa contigua start-end no formato "HH:MM". Pra
   * casos "8-12 e 14-18", cliente usa 8-18 (modelo single-window).
   */
  business_hours: BusinessHours;

  /**
   * Mensagem enviada quando lead manda msg fora do horario. Max
   * AFTER_HOURS_MESSAGE_MAX_LENGTH (500) chars.
   */
  after_hours_message: string;

  /**
   * Quando true, ao chamar `stop_agent` com handoff_notification_enabled,
   * gera resumo da conversa via GPT e injeta no template antes de
   * disparar a notificacao pra equipe. Custo: 1 chamada OpenAI extra
   * (gpt-4.1-mini). Default false pra nao surpreender com custo.
   */
  handoff_include_summary: boolean;
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

// ----------------------------------------------------------------------
// Business hours helpers
// ----------------------------------------------------------------------

/**
 * Parse "HH:MM" pra { h, m }. Retorna null se invalido ou fora do range.
 * Aceita "9:00", "09:00", "23:59" — rejeita "24:00", "9:60", "abc".
 */
function parseHHMM(text: unknown): { h: number; m: number } | null {
  if (typeof text !== "string") return null;
  const match = /^([0-2]?\d):([0-5]\d)$/.exec(text.trim());
  if (!match) return null;
  const h = Number.parseInt(match[1]!, 10);
  const m = Number.parseInt(match[2]!, 10);
  if (h < 0 || h > 23) return null;
  if (m < 0 || m > 59) return null;
  return { h, m };
}

function formatHHMM(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Valida + normaliza um DayHours. Garante start < end (mesma janela
 * no mesmo dia — sem suporte a janelas que cruzam meia-noite). Re-format
 * pra "HH:MM" pad-zero consistente. Retorna null se invalido.
 */
export function sanitizeDayHours(raw: unknown): DayHours | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const start = parseHHMM(v.start);
  const end = parseHHMM(v.end);
  if (!start || !end) return null;
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  if (startMin >= endMin) return null;
  return {
    start: formatHHMM(start.h, start.m),
    end: formatHHMM(end.h, end.m),
  };
}

/**
 * Le o BusinessHours do JSONB com defaults dia-por-dia. Quando key do
 * dia esta ausente (undefined), usa default. Quando esta `null` ou
 * invalido, normaliza pra null (= fechado). Quando esta valido,
 * sanitiza.
 */
export function sanitizeBusinessHours(raw: unknown): BusinessHours {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const result = {} as BusinessHours;
  for (const day of DAY_NAMES) {
    if (!(day in obj)) {
      result[day] = BUSINESS_HOURS_DEFAULT[day];
    } else {
      // sanitize retorna null pra valor invalido OU para null intencional
      result[day] = sanitizeDayHours(obj[day]);
    }
  }
  return result;
}

function sanitizeTimezone(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return BUSINESS_HOURS_TIMEZONE_DEFAULT;
  }
  // Defensive: tenta criar um DateTimeFormat com a tz. Se falhar
  // (ex: "America/InvalidCity"), cai pro default.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw.trim() });
    return raw.trim();
  } catch {
    return BUSINESS_HOURS_TIMEZONE_DEFAULT;
  }
}

function sanitizeAfterHoursMessage(raw: unknown): string {
  if (typeof raw !== "string") return AFTER_HOURS_MESSAGE_DEFAULT;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return AFTER_HOURS_MESSAGE_DEFAULT;
  if (trimmed.length > AFTER_HOURS_MESSAGE_MAX_LENGTH) {
    return trimmed.slice(0, AFTER_HOURS_MESSAGE_MAX_LENGTH);
  }
  return trimmed;
}

/**
 * True se `now` esta dentro da janela do dia correspondente em
 * `hours[dia]`. Usa Intl.DateTimeFormat com timezone pra extrair
 * weekday + HH:MM no fuso desejado (sem mexer em Date direto, que
 * lida em UTC).
 *
 * Comportamento defensivo: se parsing falhar (tz invalida, etc),
 * retorna `true` (= dentro do horario) pra nao bloquear o agente
 * silenciosamente.
 */
export function isWithinBusinessHours(
  now: Date,
  hours: BusinessHours,
  timezone: string = BUSINESS_HOURS_TIMEZONE_DEFAULT,
): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekdayRaw = parts.find((p) => p.type === "weekday")?.value;
    const hourRaw = parts.find((p) => p.type === "hour")?.value;
    const minuteRaw = parts.find((p) => p.type === "minute")?.value;
    if (!weekdayRaw || !hourRaw || !minuteRaw) return true;

    const weekday = weekdayRaw.toLowerCase() as DayName;
    if (!DAY_NAMES.includes(weekday)) return true;

    const day = hours[weekday];
    if (!day) return false; // dia fechado

    const start = parseHHMM(day.start);
    const end = parseHHMM(day.end);
    if (!start || !end) return true;

    // Intl com hour12: false retorna "24" pra meia-noite em alguns
    // engines — clampa pra 0 pra evitar bug raro.
    let h = Number.parseInt(hourRaw, 10);
    if (h === 24) h = 0;
    const m = Number.parseInt(minuteRaw, 10);
    const nowMinutes = h * 60 + m;
    const startMinutes = start.h * 60 + start.m;
    const endMinutes = end.h * 60 + end.m;
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } catch {
    return true;
  }
}

/**
 * True se ja passou tempo suficiente desde a ultima notificacao "fora
 * do horario" (controle de cooldown pra nao spammar). Quando
 * `lastNotifiedAtIso` e null, sempre retorna true (nunca notificado).
 */
export function shouldSendAfterHoursMessage(
  lastNotifiedAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastNotifiedAtIso) return true;
  const last = new Date(lastNotifiedAtIso);
  if (Number.isNaN(last.getTime())) return true;
  const elapsedMs = now.getTime() - last.getTime();
  const cooldownMs = AFTER_HOURS_NOTIFICATION_COOLDOWN_HOURS * 60 * 60 * 1000;
  return elapsedMs >= cooldownMs;
}

/**
 * Normaliza um keyword: trim + uppercase + remove acentos.
 *
 * Backlog #14 Auditoria (mai/2026): rodada 7 #5. Antes era apenas
 * `trim().toUpperCase()` — "pausa" nao batia com "PAUSAR" no catalogo
 * porque era match exato apos normalizar. Agora tambem remove acentos
 * pra absorver variacoes ("PAUSÁ-LO" vira "PAUSA-LO" no catalogo, mas
 * variantes mais comuns como "PAUSAR" continuam batendo via word
 * boundary do matchesPauseKeyword/matchesResumeKeyword).
 *
 * NFD + replace combina diacritics — espelhando padrao ja usado em
 * knowledge-injector + slugifyForMaterializer.
 */
export function normalizeKeyword(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
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
    business_hours_enabled:
      typeof obj.business_hours_enabled === "boolean"
        ? obj.business_hours_enabled
        : BUSINESS_HOURS_ENABLED_DEFAULT,
    business_hours_timezone: sanitizeTimezone(obj.business_hours_timezone),
    business_hours: sanitizeBusinessHours(obj.business_hours),
    after_hours_message: sanitizeAfterHoursMessage(obj.after_hours_message),
    handoff_include_summary:
      typeof obj.handoff_include_summary === "boolean"
        ? obj.handoff_include_summary
        : HANDOFF_INCLUDE_SUMMARY_DEFAULT,
  };
}

/**
 * Backlog #14 Auditoria (mai/2026): rodada 7 #5 do POST_CODEX_AUDIT.
 *
 * Antes: match por igualdade EXATA do texto inteiro contra cada keyword.
 * "PAUSAR" no catalogo so batia se lead escrevesse literalmente "PAUSAR"
 * — frases como "pausar por favor" ou "stop ia agora" nao disparavam.
 * UX dependia de lead saber a palavra exata isolada.
 *
 * Agora: word boundary regex case-insensitive + unaccent. "pausar por
 * favor" contem palavra "pausar" → bate. "nao pausar" tambem bate
 * (false positive aceito pra V1 — recomendacao do plano).
 *
 * Multi-palavra "STOP IA" matcha apenas como sequencia ("stop ia"),
 * nao "stop" sozinho — pra preservar configs explicitos.
 */
function matchesAnyKeyword(text: string, keywords: readonly string[]): boolean {
  if (!text || keywords.length === 0) return false;
  const haystack = normalizeKeyword(text);
  for (const kw of keywords) {
    // Escapa caracteres especiais regex e cria word-boundary match.
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`);
    if (re.test(haystack)) return true;
  }
  return false;
}

/**
 * True se a mensagem do lead contem algum pause keyword como palavra
 * isolada (word-boundary, case-insensitive, sem acento). Usado no
 * executor antes de processar.
 */
export function matchesPauseKeyword(
  text: string | null | undefined,
  config: HumanizationConfig,
): boolean {
  if (!text) return false;
  return matchesAnyKeyword(text, config.pause_keywords);
}

/**
 * True se a mensagem do lead contem algum resume keyword como palavra
 * isolada. Quando a conversa esta pausada (human_handoff_at != null) e
 * o lead manda um desses, IA reativa.
 */
export function matchesResumeKeyword(
  text: string | null | undefined,
  config: HumanizationConfig,
): boolean {
  if (!text) return false;
  return matchesAnyKeyword(text, config.resume_keywords);
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
