// Appointments — queries read-only compartilhadas.
//
// Inclui appointments de TODOS os kinds (appointment/event/block) — quem
// quiser filtrar passa `kinds`. Soft-deleted sao escondidos por default.

import type {
  Appointment,
  AppointmentKind,
  AppointmentStatus,
} from "../types";
import type { AgendaQueryContext } from "./context";

const SELECT_COLUMNS = `
  id, organization_id, kind, title, description,
  lead_id, user_id, service_id, booking_page_id,
  start_at, end_at, duration_minutes, timezone,
  status, channel, location, meeting_url,
  cancelled_at, cancelled_by_user_id, cancelled_by_role,
  cancellation_reason, rescheduled_from_id,
  confirmation_sent_at, reminder_sent_at,
  external_calendar_connection_id, external_event_id, external_synced_at,
  recurrence_rule,
  created_at, updated_at, deleted_at
`;

export interface ListAppointmentsFilters {
  /** ISO inclusivo. Se omitido, sem filtro inferior. */
  from?: string;
  /** ISO exclusivo. Se omitido, sem filtro superior. */
  to?: string;
  user_id?: string;
  lead_id?: string;
  booking_page_id?: string;
  kinds?: readonly AppointmentKind[];
  statuses?: readonly AppointmentStatus[];
  /** Default: false. */
  include_deleted?: boolean;
  /** Default: 'start_at' asc. */
  order?: "start_at_asc" | "start_at_desc" | "created_at_desc";
  limit?: number;
}

export async function listAppointments(
  ctx: AgendaQueryContext,
  filters: ListAppointmentsFilters = {},
): Promise<Appointment[]> {
  const { db, orgId } = ctx;
  const {
    from,
    to,
    user_id,
    lead_id,
    booking_page_id,
    kinds,
    statuses,
    include_deleted = false,
    order = "start_at_asc",
    limit = 1000,
  } = filters;

  let query = db
    .from("appointments")
    .select(SELECT_COLUMNS)
    .eq("organization_id", orgId);

  if (!include_deleted) query = query.is("deleted_at", null);
  if (from) query = query.gte("start_at", from);
  // Filtro `to` aplica em start_at pra "começa antes de to"; queries tipo
  // calendar-view usam (gte from, lt to) pra slot da janela.
  if (to) query = query.lt("start_at", to);
  if (user_id) query = query.eq("user_id", user_id);
  if (lead_id) query = query.eq("lead_id", lead_id);
  if (booking_page_id) query = query.eq("booking_page_id", booking_page_id);
  if (kinds && kinds.length > 0) query = query.in("kind", kinds);
  if (statuses && statuses.length > 0) query = query.in("status", statuses);

  switch (order) {
    case "start_at_desc":
      query = query.order("start_at", { ascending: false });
      break;
    case "created_at_desc":
      query = query.order("created_at", { ascending: false });
      break;
    default:
      query = query.order("start_at", { ascending: true });
  }
  query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`listAppointments: ${error.message}`);
  return (data ?? []) as Appointment[];
}

export async function getAppointment(
  ctx: AgendaQueryContext,
  id: string,
): Promise<Appointment | null> {
  const { db, orgId } = ctx;
  const { data, error } = await db
    .from("appointments")
    .select(SELECT_COLUMNS)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getAppointment: ${error.message}`);
  return (data as Appointment | null) ?? null;
}

/**
 * Lista appointments candidatos a conflitar com a janela [from, to) pro
 * user_id passado. Usado como input pra findScheduleConflict do shared.
 * Sempre traz status bloqueante apenas (awaiting_confirmation, confirmed,
 * rescheduled). Esconde soft-deleted.
 */
export async function listConflictCandidates(
  ctx: AgendaQueryContext,
  args: {
    user_id: string;
    from: string;
    to: string;
    /** Exclui esse id (caso edicao). */
    exclude_id?: string;
  },
): Promise<Appointment[]> {
  const { db, orgId } = ctx;
  const { user_id, from, to, exclude_id } = args;

  let query = db
    .from("appointments")
    .select(SELECT_COLUMNS)
    .eq("organization_id", orgId)
    .eq("user_id", user_id)
    .is("deleted_at", null)
    .in("status", ["awaiting_confirmation", "confirmed", "rescheduled"])
    // Janela: existing.start < to AND existing.end > from
    .lt("start_at", to)
    .gt("end_at", from);

  if (exclude_id) query = query.neq("id", exclude_id);

  const { data, error } = await query;
  if (error) throw new Error(`listConflictCandidates: ${error.message}`);
  return (data ?? []) as Appointment[];
}
