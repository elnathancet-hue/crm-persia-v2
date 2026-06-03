// AI Agent — Follow-up Automatico contracts.
//
// Diferente de scheduled-jobs:
//   - Scheduled jobs: cron + filtro de leads. Dispara em horario fixo
//     pra leads que batem critério ("toda segunda 9h pra leads com tag X").
//   - Follow-ups: por conversa, baseado em "tempo desde a ultima mensagem
//     do lead". Dispara quando uma conversa fica inativa por X horas
//     ("avisa o lead 24h depois se ele nao respondeu").
//
// Caso de uso classico: empresa quer 3 lembretes em cascata (24h / 48h /
// 72h sem resposta). Sem follow-up, lead esfria e e perdido.

// ============================================================================
// Limits & validation
// ============================================================================

// Limite por agente. Mais que isso e overkill — em geral 2-4 follow-ups
// cobrem todo o funil. Mais e spam.
export const FOLLOWUPS_MAX_PER_AGENT = 5;

// Janela de delay: mínimo 1h (evita disparo logo apos a ultima msg, que
// seria robotico) e maximo 30 dias (depois disso o lead ja foi).
export const FOLLOWUP_DELAY_HOURS_MIN = 1;
export const FOLLOWUP_DELAY_HOURS_MAX = 24 * 30; // 720h

// Tamanho do nome ("Follow-up 1", "Lembrete 24h sem resposta", etc.).
export const FOLLOWUP_NAME_MIN_CHARS = 3;
export const FOLLOWUP_NAME_MAX_CHARS = 80;
export const FOLLOWUP_MESSAGE_MIN_CHARS = 1;
export const FOLLOWUP_MESSAGE_MAX_CHARS = 4000;

export function clampFollowupDelayHours(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 24;
  return Math.max(
    FOLLOWUP_DELAY_HOURS_MIN,
    Math.min(FOLLOWUP_DELAY_HOURS_MAX, Math.round(value)),
  );
}

// Formata o delay pro UI ("24 horas", "2 dias", "1 semana"). Usa
// arredondamento PT-BR-friendly.
export function formatFollowupDelay(hours: number): string {
  if (hours < 24) {
    return hours === 1 ? "1 hora" : `${hours} horas`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return days === 1 ? "1 dia" : `${days} dias`;
  }
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "1 semana" : `${weeks} semanas`;
}

// Presets exibidos no select de delay no editor. Cobre 90% dos casos
// reais (24h/48h/72h cascade). Cliente pode digitar custom.
export const FOLLOWUP_DELAY_PRESETS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 1, label: "1 hora" },
  { hours: 4, label: "4 horas" },
  { hours: 24, label: "24 horas (1 dia)" },
  { hours: 48, label: "48 horas (2 dias)" },
  { hours: 72, label: "72 horas (3 dias)" },
  { hours: 168, label: "1 semana" },
  { hours: 336, label: "2 semanas" },
];

export const FOLLOWUP_DEFAULT_SEND_WINDOW_START = "08:00";
export const FOLLOWUP_DEFAULT_SEND_WINDOW_END = "18:00";

export function normalizeFollowupWindowTime(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : FOLLOWUP_DEFAULT_SEND_WINDOW_START;
}

export function isValidFollowupWindow(start: string, end: string): boolean {
  return /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start < end;
}

// ============================================================================
// Domain types — mirror agent_followups + agent_followup_runs
// ============================================================================

export interface AgentFollowup {
  id: string;
  organization_id: string;
  config_id: string;
  name: string;
  // Aponta pra um agent_notification_template (msg WhatsApp pre-aprovada).
  // Reusa o mesmo motor de envio do scheduled-jobs / handoff.
  template_id: string | null;
  message_text: string | null;
  // Horas de inatividade da conversa apos as quais o follow-up dispara.
  // E contado a partir do `last_inbound_message_at` da conversation
  // (NAO da ultima msg do agente). Se o lead respondeu, conta zera.
  delay_hours: number;
  is_enabled: boolean;
  // Ordem de exibicao no editor. Disparo NAO depende de ordem — cada
  // follow-up tem seu proprio gatilho independente.
  order_index: number;
  send_window_start: string;
  send_window_end: string;
  require_ai_active: boolean;
  created_at: string;
  updated_at: string;
}

// Idempotency log: 1 disparo por (followup_id, conversation_id).
// Garante que mesmo se o cron rodar 2x na mesma janela, o lead so
// recebe o lembrete uma vez. Cleanup periodico (>90d) recomendado.
export interface AgentFollowupRun {
  id: string;
  followup_id: string;
  organization_id: string;
  conversation_id: string;
  fired_at: string;
  status: "sending" | "sent" | "failed" | "skipped";
  error_message: string | null;
  sent_at: string | null;
}

export type AgentFollowupConversationStatus =
  | "waiting"
  | "eligible"
  | "sent"
  | "paused"
  | "cancelled"
  | "finished";

export interface AgentFollowupConversationState {
  id: string;
  organization_id: string;
  config_id: string;
  agent_conversation_id: string;
  current_followup_id: string | null;
  current_order_index: number;
  status: AgentFollowupConversationStatus;
  next_run_at: string | null;
  last_company_message_at: string | null;
  last_lead_message_at: string | null;
  last_sent_at: string | null;
  pause_reason: string | null;
  cancel_reason: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Action input/output
// ============================================================================

export interface CreateFollowupInput {
  config_id: string;
  name: string;
  template_id?: string | null;
  message_text?: string | null;
  delay_hours: number;
  is_enabled?: boolean;
  send_window_start?: string;
  send_window_end?: string;
  require_ai_active?: boolean;
}

export interface UpdateFollowupInput {
  name?: string;
  template_id?: string | null;
  message_text?: string | null;
  delay_hours?: number;
  is_enabled?: boolean;
  order_index?: number;
  send_window_start?: string;
  send_window_end?: string;
  require_ai_active?: boolean;
}

// ============================================================================
// Validation helpers (UI + server)
// ============================================================================

export interface FollowupValidationErrors {
  name?: string;
  template_id?: string;
  message_text?: string;
  delay_hours?: string;
  send_window?: string;
}

export function validateFollowupInput(
  input: Pick<CreateFollowupInput, "name" | "delay_hours"> &
    Partial<Pick<CreateFollowupInput, "template_id" | "message_text">> &
    Partial<Pick<CreateFollowupInput, "send_window_start" | "send_window_end">>,
): FollowupValidationErrors {
  const errors: FollowupValidationErrors = {};
  const name = input.name?.trim() ?? "";
  if (!name) {
    errors.name = "Nome é obrigatório";
  } else if (name.length < FOLLOWUP_NAME_MIN_CHARS) {
    errors.name = `Mínimo ${FOLLOWUP_NAME_MIN_CHARS} caracteres`;
  } else if (name.length > FOLLOWUP_NAME_MAX_CHARS) {
    errors.name = `Máximo ${FOLLOWUP_NAME_MAX_CHARS} caracteres`;
  }
  const message = input.message_text?.trim() ?? "";
  if (!input.template_id && !message) {
    errors.message_text = "Mensagem e obrigatoria";
  } else if (message.length > FOLLOWUP_MESSAGE_MAX_CHARS) {
    errors.message_text = `Maximo ${FOLLOWUP_MESSAGE_MAX_CHARS} caracteres`;
  }
  if (
    input.delay_hours == null ||
    !Number.isFinite(input.delay_hours) ||
    input.delay_hours < FOLLOWUP_DELAY_HOURS_MIN ||
    input.delay_hours > FOLLOWUP_DELAY_HOURS_MAX
  ) {
    errors.delay_hours = `Entre ${FOLLOWUP_DELAY_HOURS_MIN}h e ${FOLLOWUP_DELAY_HOURS_MAX}h`;
  }
  const start = input.send_window_start ?? FOLLOWUP_DEFAULT_SEND_WINDOW_START;
  const end = input.send_window_end ?? FOLLOWUP_DEFAULT_SEND_WINDOW_END;
  if (!isValidFollowupWindow(start, end)) {
    errors.send_window = "A janela deve ter inicio menor que o fim";
  }
  return errors;
}
