// Google Calendar — event helpers.
//
// PR-FLOW-PIVOT PR 14b (mai/2026): wrappers sobre o endpoint
// `/calendar/v3/calendars/{calendarId}/events` da Google Calendar API.
// Usado pelos handlers create_appointment / cancel_appointment /
// reschedule_appointment pra espelhar appointments internos no Google.
//
// Strategy V1 (one-way push):
//   - CRM cria/atualiza/cancela appointment → também faz no Google
//   - Google NÃO atualiza CRM (sem webhooks/pull em V1; PR 14c V2)
//   - Falha de sync = log + segue (appointment interno é source of
//     truth; Google é mirror best-effort)
//
// Helper `loadGoogleConnectionForOrg` centraliza o load + check de
// "está conectado e usável" pra os handlers não duplicarem lógica.

import { errorMessage, logError } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "@/lib/ai-agent/db";
import {
  getValidAccessToken,
  type GoogleCalendarConnection,
} from "./api";

const GOOGLE_API_BASE = "https://www.googleapis.com";

// ============================================================================
// Connection loader
// ============================================================================

/**
 * Carrega a conexão Google Calendar da org E verifica se está utilizável
 * (is_active + default_calendar_id setado). Retorna null se org não tem
 * sync configurado — caller faz fallback pra comportamento legacy
 * (appointment só interno).
 *
 * Defensive: tabela ausente (migration 059 pendente) = null. Log warn.
 */
export async function loadGoogleConnectionForOrg(
  supabaseOrAgentDb: AgentDb | { from: (table: string) => unknown },
  orgId: string,
): Promise<(GoogleCalendarConnection & { default_calendar_id: string }) | null> {
  const db = asAgentDb(supabaseOrAgentDb as AgentDb);
  try {
    const { data, error } = await db
      .from("google_calendar_connections")
      .select(
        "organization_id, google_account_email, refresh_token, access_token, access_token_expires_at, default_calendar_id, calendar_list, scope, is_active",
      )
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) {
      const msg = error.message ?? "";
      if (
        /relation .*google_calendar_connections.* does not exist/i.test(msg) ||
        /could not find the table/i.test(msg) ||
        msg.includes("PGRST205")
      ) {
        return null;
      }
      logError("gcal_events_load_conn_failed", {
        organization_id: orgId,
        error: msg,
      });
      return null;
    }
    if (!data) return null;
    const conn = data as GoogleCalendarConnection;
    if (!conn.is_active) return null;
    if (!conn.default_calendar_id) return null;
    return conn as GoogleCalendarConnection & { default_calendar_id: string };
  } catch (err) {
    logError("gcal_events_load_conn_threw", {
      organization_id: orgId,
      error: errorMessage(err),
    });
    return null;
  }
}

// ============================================================================
// Event shape — minimal V1
// ============================================================================

export interface GoogleCalendarEventInput {
  summary: string;
  description?: string | null;
  location?: string | null;
  /** ISO 8601 with timezone OR `2026-05-21T15:00:00` paired w/ timeZone field */
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees?: Array<{ email: string; displayName?: string }>;
}

export interface GoogleCalendarEventResponse {
  id: string;
  htmlLink?: string;
  status?: string;
}

// ============================================================================
// Create / Update / Delete
// ============================================================================

export async function createGoogleEvent(
  db: AgentDb | { from: (table: string) => unknown },
  conn: GoogleCalendarConnection,
  calendarId: string,
  event: GoogleCalendarEventInput,
): Promise<GoogleCalendarEventResponse> {
  const accessToken = await getValidAccessToken(asAgentDb(db as AgentDb), conn);
  const res = await fetch(
    `${GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=0`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google createEvent falhou (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as GoogleCalendarEventResponse;
  if (!json.id) throw new Error("Google createEvent response sem id");
  return json;
}

export async function updateGoogleEvent(
  db: AgentDb | { from: (table: string) => unknown },
  conn: GoogleCalendarConnection,
  calendarId: string,
  eventId: string,
  patch: Partial<GoogleCalendarEventInput>,
): Promise<GoogleCalendarEventResponse> {
  const accessToken = await getValidAccessToken(asAgentDb(db as AgentDb), conn);
  const res = await fetch(
    `${GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google updateEvent falhou (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as GoogleCalendarEventResponse;
}

export async function deleteGoogleEvent(
  db: AgentDb | { from: (table: string) => unknown },
  conn: GoogleCalendarConnection,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const accessToken = await getValidAccessToken(asAgentDb(db as AgentDb), conn);
  const res = await fetch(
    `${GOOGLE_API_BASE}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  // 404 = event já não existe (alguém deletou no Google direto). Trata
  // como sucesso pra idempotência.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google deleteEvent falhou (${res.status}): ${text.slice(0, 200)}`,
    );
  }
}

// ============================================================================
// Helper: monta payload de event a partir de appointment + lead
// ============================================================================

/**
 * Constrói o input do Google event a partir dos campos do appointment.
 * Centraliza a formatação pra create + update usarem o mesmo shape.
 */
export function buildEventFromAppointment(params: {
  title: string;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
  startAt: string; // ISO 8601
  endAt: string; // ISO 8601
  timezone: string;
  leadEmail: string | null;
  leadName: string | null;
  leadPhone: string | null;
}): GoogleCalendarEventInput {
  // Description compõe: notas + dados do lead pra contato fácil.
  const descParts: string[] = [];
  if (params.description) descParts.push(params.description);
  if (params.leadName || params.leadPhone) {
    descParts.push("");
    descParts.push("--- Contato do lead ---");
    if (params.leadName) descParts.push(`Nome: ${params.leadName}`);
    if (params.leadPhone) descParts.push(`WhatsApp: ${params.leadPhone}`);
  }
  if (params.meetingUrl) {
    descParts.push("");
    descParts.push(`Link da reunião: ${params.meetingUrl}`);
  }

  const attendees: Array<{ email: string; displayName?: string }> = [];
  if (params.leadEmail && /.+@.+\..+/.test(params.leadEmail)) {
    attendees.push({
      email: params.leadEmail,
      ...(params.leadName ? { displayName: params.leadName } : {}),
    });
  }

  return {
    summary: params.title,
    description: descParts.length > 0 ? descParts.join("\n") : null,
    location: params.location || params.meetingUrl || null,
    start: { dateTime: params.startAt, timeZone: params.timezone },
    end: { dateTime: params.endAt, timeZone: params.timezone },
    ...(attendees.length > 0 ? { attendees } : {}),
  };
}
