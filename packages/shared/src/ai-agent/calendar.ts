// AI Agent — PR7.3 Google Calendar integration contract.
//
// Conexões OAuth com Google Calendar a nível de **organização**. Cada
// org pode conectar 1+ calendários (típico: cada operador conecta o
// seu); cada agente escolhe qual conexão usar quando dispara o handler
// `schedule_event`.
//
// O handler permite o agente:
//   - listar eventos próximos do calendário escolhido (pra sugerir
//     horários livres ao lead)
//   - criar evento com lead como participante (Google envia convite)
//   - cancelar evento existente
//
// Schema lives em migration 026. Runtime (OAuth callback +
// google-calendar-client + handler) lives em
// `apps/crm/src/lib/ai-agent/calendar/` + `/api/oauth/google/callback`
// (Codex, PR7.3b).
//
// SEGURANÇA: refresh_token é guardado encrypted via Supabase Vault.
// Runtime nunca loga o token cleartext em audit nem em error.

// ============================================================================
// OAuth — escopo + endpoints
// ============================================================================

// Único escopo necessário pro feature set atual. Se adicionar Gmail
// ou Drive depois, vira lista.
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events" as const;

// Authorization endpoint do Google. Adicionado client_id, redirect_uri
// e state via querystring no runtime.
export const GOOGLE_OAUTH_AUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth" as const;

// Token endpoint (POST com code = exchange por access + refresh).
export const GOOGLE_OAUTH_TOKEN_URL =
  "https://oauth2.googleapis.com/token" as const;

// Callback path interno do CRM. Configurado também no Google Cloud
// Console como Authorized redirect URI.
export const GOOGLE_OAUTH_CALLBACK_PATH =
  "/api/oauth/google/callback" as const;

// ============================================================================
// Calendar connection (per-org, multi)
// ============================================================================

export type CalendarConnectionStatus = "active" | "revoked" | "expired";

export interface AgentCalendarConnection {
  id: string;
  organization_id: string;
  // Quem conectou (operador). Não é dono do calendário Google
  // necessariamente — só quem fez o OAuth flow.
  connected_by_user_id: string;
  // Email do Google account associado. Mostrado na UI pra
  // distinguir conexões.
  google_account_email: string;
  // Calendar ID do Google. "primary" pra o calendário principal do
  // usuário; pode ser ID de calendário compartilhado (ex:
  // "abc123@group.calendar.google.com").
  google_calendar_id: string;
  // Display name escolhido pelo admin. Default = google_account_email.
  display_name: string;
  // Refresh token CRIPTOGRAFADO via Supabase Vault. Type aqui é
  // `string` pq o cliente nunca ve o cleartext — o runtime resolve via
  // SECURITY DEFINER function que acessa o Vault.
  // NÃO expor esse campo em UI nem em API JSON.
  encrypted_refresh_token_id: string;
  status: CalendarConnectionStatus;
  // Última vez que um access_token foi refreshed com sucesso. Sinaliza
  // saúde da conexão.
  last_refreshed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// View-safe (sem o token id) — UI deve usar este shape.
export type AgentCalendarConnectionPublic = Omit<
  AgentCalendarConnection,
  "encrypted_refresh_token_id"
>;

export function toPublicConnection(
  conn: AgentCalendarConnection,
): AgentCalendarConnectionPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { encrypted_refresh_token_id: _omit, ...rest } = conn;
  return rest;
}

// ============================================================================
// Per-agent assignment — qual conexão cada agente usa
// ============================================================================

// Decisão: agente APONTA pra UMA connection (1:1, opcional). Se null,
// agente não tem calendário e o handler `schedule_event` retorna erro.
// Coluna nova em `agent_configs`: `calendar_connection_id UUID`.

// ============================================================================
// Handler `schedule_event` — input/output
// ============================================================================

export type ScheduleEventAction = "create" | "list" | "cancel";

// O LLM passa `action` e o resto depende dela. Validação:
// - action="create": event_summary, start_time, duration_minutes,
//   attendee_email opcional
// - action="list": time_min opcional, time_max opcional, max_results
//   opcional (default 10)
// - action="cancel": event_id obrigatório
export interface ScheduleEventHandlerInput {
  action: ScheduleEventAction;
  event_summary?: string;
  event_description?: string;
  // ISO 8601. Se sem timezone, runtime assume calendar timezone.
  start_time?: string;
  duration_minutes?: number;
  attendee_email?: string;
  // List
  time_min?: string;
  time_max?: string;
  max_results?: number;
  // Cancel
  event_id?: string;
}

export interface CalendarEventSummary {
  event_id: string;
  summary: string;
  start_time: string;
  end_time: string;
  attendees: string[];
  html_link: string; // link pro evento no Google Calendar
}

export interface ScheduleEventHandlerResult {
  success: boolean;
  action: ScheduleEventAction;
  event?: CalendarEventSummary;
  events?: CalendarEventSummary[]; // só pra action="list"
  error?: string;
}

// ============================================================================
// Limits + validation
// ============================================================================

export const SCHEDULE_EVENT_DURATION_MIN_MINUTES = 5;
export const SCHEDULE_EVENT_DURATION_MAX_MINUTES = 480; // 8h
export const SCHEDULE_EVENT_LIST_MAX_RESULTS = 25;
export const SCHEDULE_EVENT_LIST_DEFAULT_RESULTS = 10;

// Quanto pra frente o agente pode olhar/criar.
export const SCHEDULE_EVENT_MAX_DAYS_AHEAD = 90;

// ============================================================================
// Audit step payloads
// ============================================================================

export interface ScheduleEventStepInput {
  action: ScheduleEventAction;
  // Event summary é PII baixo (título tipo "Reunião com Maria"); ok logar
  event_summary?: string;
  start_time?: string;
  duration_minutes?: number;
  // Attendee email é PII médio — logamos masked
  attendee_email_masked?: string;
}

export interface ScheduleEventStepOutput {
  success: boolean;
  action: ScheduleEventAction;
  event_id?: string;
  events_returned?: number;
  duration_ms: number;
  error?: string;
}

export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at < 1) return trimmed;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.length > 2 ? local.slice(0, 2) : local[0] ?? "";
  return `${visible}***@${domain}`;
}

// ============================================================================
// Validation helpers (UI + server)
// ============================================================================

export function validateScheduleEventInput(
  input: ScheduleEventHandlerInput,
): void {
  if (input.action === "create") {
    if (!input.event_summary?.trim()) {
      throw new Error("event_summary obrigatório pra criar evento");
    }
    if (!input.start_time) {
      throw new Error("start_time obrigatório pra criar evento");
    }
    const startDate = new Date(input.start_time);
    if (Number.isNaN(startDate.getTime())) {
      throw new Error("start_time não é ISO 8601 válido");
    }
    const maxAhead = Date.now() + SCHEDULE_EVENT_MAX_DAYS_AHEAD * 86400_000;
    if (startDate.getTime() > maxAhead) {
      throw new Error(
        `start_time não pode estar mais de ${SCHEDULE_EVENT_MAX_DAYS_AHEAD} dias no futuro`,
      );
    }
    const duration = input.duration_minutes ?? 30;
    if (
      duration < SCHEDULE_EVENT_DURATION_MIN_MINUTES ||
      duration > SCHEDULE_EVENT_DURATION_MAX_MINUTES
    ) {
      throw new Error(
        `duration_minutes fora do range ${SCHEDULE_EVENT_DURATION_MIN_MINUTES}–${SCHEDULE_EVENT_DURATION_MAX_MINUTES}`,
      );
    }
  } else if (input.action === "cancel") {
    if (!input.event_id) {
      throw new Error("event_id obrigatório pra cancelar");
    }
  } else if (input.action === "list") {
    const max = input.max_results ?? SCHEDULE_EVENT_LIST_DEFAULT_RESULTS;
    if (max < 1 || max > SCHEDULE_EVENT_LIST_MAX_RESULTS) {
      throw new Error(
        `max_results fora do range 1–${SCHEDULE_EVENT_LIST_MAX_RESULTS}`,
      );
    }
  } else {
    throw new Error(`action inválido: ${String((input as { action: unknown }).action)}`);
  }
}
