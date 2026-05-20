// Google Calendar — pull sync (Google → CRM).
//
// PR-FLOW-PIVOT PR 14c (mai/2026): cron a cada 5min itera todas as
// conexões ativas + chama events.list com updatedMin = last_polled_at.
// Pra cada event retornado, se google_event_id casa com algum
// appointment do org, reflete a mudança no CRM:
//   - event.status === 'cancelled' → cancela appointment internal
//     (sem notificar lead — admin deve avisar via canal próprio)
//   - start/end mudaram → update appointment.start_at/end_at/duration
//   - Nada bate → ignore silencioso (event que não foi criado pela IA)
//
// V1 NÃO faz:
//   - syncToken (Google nextSyncToken) — mais limpo mas exige reset
//     em 410 Gone. updatedMin é suficiente pra MVP
//   - Pagination — assumimos <250 changes per 5min window por org
//   - Notify lead em changes externas — admin precisa avisar por fora
//     (V2 pode adicionar opt-in)
//   - Detectar event NOVO no Google (sem google_event_id associado)
//     pra criar appointment — exige lead matching, complexo

import { createClient } from "@supabase/supabase-js";
import { cancelAppointment as cancelSharedAppointment } from "@persia/shared/agenda";
import { errorMessage, logError } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "@/lib/ai-agent/db";
import {
  listEventsUpdatedSince,
  type GoogleCalendarConnection,
  type GoogleCalendarEventListItem,
} from "./api";

// ============================================================================
// Service-role client (cron context — sem user session)
// ============================================================================

function getServiceClient(): AgentDb {
  return asAgentDb(
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    ),
  );
}

// ============================================================================
// Public API
// ============================================================================

export interface PollOutcome {
  organizations_processed: number;
  organizations_failed: number;
  events_synced: number;
  appointments_cancelled: number;
  appointments_updated: number;
}

/**
 * Itera todas as conexões ativas + sincroniza changes desde
 * last_polled_at. Retorna resumo pra observabilidade do endpoint cron.
 */
export async function pollAllOrgs(): Promise<PollOutcome> {
  const db = getServiceClient();
  const outcome: PollOutcome = {
    organizations_processed: 0,
    organizations_failed: 0,
    events_synced: 0,
    appointments_cancelled: 0,
    appointments_updated: 0,
  };

  let connections: GoogleCalendarConnection[];
  try {
    const { data, error } = await db
      .from("google_calendar_connections")
      .select(
        "organization_id, google_account_email, refresh_token, access_token, access_token_expires_at, default_calendar_id, calendar_list, scope, is_active, last_polled_at",
      )
      .eq("is_active", true)
      .not("default_calendar_id", "is", null);
    if (error) {
      logError("gcal_poll_load_conns_failed", { error: error.message });
      return outcome;
    }
    connections = (data ?? []) as Array<
      GoogleCalendarConnection & { last_polled_at: string | null }
    >;
  } catch (err) {
    logError("gcal_poll_load_conns_threw", { error: errorMessage(err) });
    return outcome;
  }

  for (const conn of connections) {
    try {
      const result = await pollSingleOrg(db, conn);
      outcome.organizations_processed++;
      outcome.events_synced += result.events_synced;
      outcome.appointments_cancelled += result.appointments_cancelled;
      outcome.appointments_updated += result.appointments_updated;
    } catch (err) {
      outcome.organizations_failed++;
      logError("gcal_poll_org_failed", {
        organization_id: conn.organization_id,
        error: errorMessage(err),
      });
    }
  }

  return outcome;
}

// ============================================================================
// Internal: pollSingleOrg
// ============================================================================

interface SinglePollResult {
  events_synced: number;
  appointments_cancelled: number;
  appointments_updated: number;
}

const FALLBACK_BACKLOG_HOURS = 24; // 1ª execução: olha últimas 24h

async function pollSingleOrg(
  db: AgentDb,
  conn: GoogleCalendarConnection & { last_polled_at?: string | null },
): Promise<SinglePollResult> {
  const result: SinglePollResult = {
    events_synced: 0,
    appointments_cancelled: 0,
    appointments_updated: 0,
  };

  const calendarId = conn.default_calendar_id;
  if (!calendarId) return result;

  // updatedMin: usa last_polled_at se existir; senão, últimas 24h pra
  // evitar baixar histórico inteiro. RFC3339 obrigatório.
  const updatedMin = conn.last_polled_at
    ? conn.last_polled_at
    : new Date(Date.now() - FALLBACK_BACKLOG_HOURS * 60 * 60 * 1000).toISOString();

  // Marca o "now" antes da chamada — se chegar mais events durante
  // a request, próximo poll pega.
  const newWatermark = new Date().toISOString();

  const events = await listEventsUpdatedSince(db, conn, calendarId, updatedMin);
  result.events_synced = events.length;

  // Processa cada event — match contra appointment via google_event_id.
  for (const event of events) {
    try {
      const matched = await processEvent(db, conn.organization_id, event);
      if (matched === "cancelled") result.appointments_cancelled++;
      else if (matched === "updated") result.appointments_updated++;
    } catch (err) {
      logError("gcal_poll_process_event_failed", {
        organization_id: conn.organization_id,
        event_id: event.id,
        error: errorMessage(err),
      });
    }
  }

  // Update watermark — mesmo se algum event falhou, avança (próximo
  // poll não retenta esses; logs cobrem).
  await db
    .from("google_calendar_connections")
    .update({ last_polled_at: newWatermark })
    .eq("organization_id", conn.organization_id);

  return result;
}

async function processEvent(
  db: AgentDb,
  orgId: string,
  event: GoogleCalendarEventListItem,
): Promise<"cancelled" | "updated" | "skipped"> {
  // 1. Localiza appointment correspondente.
  const { data: apptRow, error } = await db
    .from("appointments")
    .select("id, lead_id, start_at, end_at, duration_minutes, status")
    .eq("organization_id", orgId)
    .eq("google_event_id", event.id)
    .maybeSingle();
  if (error) {
    throw new Error(`appointment lookup falhou: ${error.message}`);
  }
  if (!apptRow) return "skipped"; // event não é nosso

  const appt = apptRow as {
    id: string;
    lead_id: string | null;
    start_at: string;
    end_at: string;
    duration_minutes: number;
    status: string;
  };

  // 2. Caso A: Event cancelado no Google (event.status === 'cancelled').
  if (event.status === "cancelled") {
    if (appt.status === "cancelled" || appt.status === "rescheduled") {
      return "skipped";
    }
    try {
      await cancelSharedAppointment(
        { db, orgId, userId: null, performedByRole: "agent" },
        appt.id,
        {
          reason: "cancelado externamente no Google Calendar",
          cancelled_by_role: "agent",
        },
      );
      return "cancelled";
    } catch (err) {
      throw new Error(`cancelSharedAppointment falhou: ${errorMessage(err)}`);
    }
  }

  // 3. Caso B: Start/end mudaram. V1 update direto na tabela (sem
  // shared mutation porque rescheduleAppointment cria replacement —
  // não queremos isso quando admin moveu no Google, é o MESMO event).
  const newStart = event.start?.dateTime;
  const newEnd = event.end?.dateTime;
  if (!newStart || !newEnd) {
    // All-day event ou shape inválido — V1 ignora.
    return "skipped";
  }

  // Normaliza pra comparar (Date.parse + ISO).
  const newStartIso = new Date(newStart).toISOString();
  const newEndIso = new Date(newEnd).toISOString();
  const currentStartIso = new Date(appt.start_at).toISOString();
  const currentEndIso = new Date(appt.end_at).toISOString();

  if (newStartIso === currentStartIso && newEndIso === currentEndIso) {
    return "skipped"; // Mesmo horário, só metadata mudou
  }

  const newDurationMs = Date.parse(newEnd) - Date.parse(newStart);
  const newDurationMin = Math.max(15, Math.round(newDurationMs / 60_000));

  const { error: updateErr } = await db
    .from("appointments")
    .update({
      start_at: newStartIso,
      end_at: newEndIso,
      duration_minutes: newDurationMin,
    })
    .eq("organization_id", orgId)
    .eq("id", appt.id);
  if (updateErr) {
    throw new Error(`update appointment falhou: ${updateErr.message}`);
  }

  // Log no histórico do lead pra rastreabilidade.
  if (appt.lead_id) {
    try {
      await db.from("lead_activities").insert({
        organization_id: orgId,
        lead_id: appt.lead_id,
        type: "appointment_rescheduled_externally",
        description: `Agendamento ${appt.id} movido no Google Calendar pra ${newStartIso}`,
        metadata: {
          source: "google_calendar_pull",
          appointment_id: appt.id,
          from_start_at: currentStartIso,
          to_start_at: newStartIso,
        },
        performed_by: null,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      // Best-effort — não bloqueia o update do appointment.
      logError("gcal_poll_activity_log_failed", {
        organization_id: orgId,
        appointment_id: appt.id,
        error: errorMessage(err),
      });
    }
  }

  return "updated";
}
