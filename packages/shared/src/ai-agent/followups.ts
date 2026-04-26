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
  template_id: string;
  // Horas de inatividade da conversa apos as quais o follow-up dispara.
  // E contado a partir do `last_inbound_message_at` da conversation
  // (NAO da ultima msg do agente). Se o lead respondeu, conta zera.
  delay_hours: number;
  is_enabled: boolean;
  // Ordem de exibicao no editor. Disparo NAO depende de ordem — cada
  // follow-up tem seu proprio gatilho independente.
  order_index: number;
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
}

// ============================================================================
// Action input/output
// ============================================================================

export interface CreateFollowupInput {
  config_id: string;
  name: string;
  template_id: string;
  delay_hours: number;
  is_enabled?: boolean;
}

export interface UpdateFollowupInput {
  name?: string;
  template_id?: string;
  delay_hours?: number;
  is_enabled?: boolean;
  order_index?: number;
}

// ============================================================================
// Validation helpers (UI + server)
// ============================================================================

export interface FollowupValidationErrors {
  name?: string;
  template_id?: string;
  delay_hours?: string;
}

export function validateFollowupInput(
  input: Pick<CreateFollowupInput, "name" | "template_id" | "delay_hours">,
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
  if (!input.template_id) {
    errors.template_id = "Selecione um template ativo";
  }
  if (
    input.delay_hours == null ||
    !Number.isFinite(input.delay_hours) ||
    input.delay_hours < FOLLOWUP_DELAY_HOURS_MIN ||
    input.delay_hours > FOLLOWUP_DELAY_HOURS_MAX
  ) {
    errors.delay_hours = `Entre ${FOLLOWUP_DELAY_HOURS_MIN}h e ${FOLLOWUP_DELAY_HOURS_MAX}h`;
  }
  return errors;
}
