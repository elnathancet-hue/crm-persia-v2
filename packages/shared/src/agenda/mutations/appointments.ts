// Appointments — mutations compartilhadas (create/update/cancel/reschedule/delete).
//
// Toda mutation:
//   1) Valida input minimo (start < end, etc)
//   2) Pra kind='appointment', detecta conflito server-side via
//      listConflictCandidates + findScheduleConflict (mesma logica do
//      front, agora autoritativa no server)
//   3) Aplica a mudanca
//   4) Insere appointment_history (best-effort)

import {
  type Appointment,
  type AppointmentInsert,
  type AppointmentStatus,
  type AppointmentUpdate,
  type CancellationRole,
  BLOCKING_APPOINTMENT_STATUSES,
} from "../types";
import { findScheduleConflict } from "../availability";
import { listConflictCandidates, getAppointment } from "../queries/appointments";
import type { AgendaMutationContext } from "../queries/context";
import { insertHistory } from "./history";

const RETURN_COLUMNS = `
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

export class AppointmentConflictError extends Error {
  constructor(
    message: string,
    public conflict: Appointment,
  ) {
    super(message);
    this.name = "AppointmentConflictError";
  }
}

export class AppointmentValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "AppointmentValidationError";
  }
}

function validateTimeWindow(start_at: string, end_at: string) {
  const s = new Date(start_at).getTime();
  const e = new Date(end_at).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) {
    throw new AppointmentValidationError(
      "start_at/end_at em formato invalido",
      "start_at",
    );
  }
  if (e <= s) {
    throw new AppointmentValidationError(
      "Termino deve ser apos o inicio",
      "end_at",
    );
  }
}

async function ensureNoConflict(
  ctx: AgendaMutationContext,
  args: {
    user_id: string;
    start_at: string;
    end_at: string;
    exclude_id?: string;
  },
): Promise<void> {
  const candidates = await listConflictCandidates(
    { db: ctx.db, orgId: ctx.orgId },
    {
      user_id: args.user_id,
      from: args.start_at,
      to: args.end_at,
      exclude_id: args.exclude_id,
    },
  );
  const conflict = findScheduleConflict(
    {
      start_at: args.start_at,
      end_at: args.end_at,
      user_id: args.user_id,
      id: args.exclude_id,
    },
    candidates,
  );
  if (conflict) {
    throw new AppointmentConflictError(
      `Conflito com "${conflict.title}" (${conflict.start_at} - ${conflict.end_at})`,
      conflict,
    );
  }
}

// ============================================================================
// createAppointment
// ============================================================================

export interface CreateAppointmentInput
  extends Omit<AppointmentInsert, "organization_id"> {
  /** Default true. Quando false, pula a checagem de conflito (uso: cron/import). */
  enforce_conflict_check?: boolean;
}

export async function createAppointment(
  ctx: AgendaMutationContext,
  input: CreateAppointmentInput,
): Promise<Appointment> {
  const { db, orgId } = ctx;
  const { enforce_conflict_check = true, ...rest } = input;

  validateTimeWindow(rest.start_at, rest.end_at);

  if (rest.kind === "appointment" && enforce_conflict_check) {
    await ensureNoConflict(ctx, {
      user_id: rest.user_id,
      start_at: rest.start_at,
      end_at: rest.end_at,
    });
  }

  const { data, error } = await db
    .from("appointments")
    .insert({
      ...rest,
      organization_id: orgId,
    })
    .select(RETURN_COLUMNS)
    .single();

  if (error) throw new Error(`createAppointment: ${error.message}`);
  const created = data as Appointment;

  await insertHistory(ctx, {
    appointment_id: created.id,
    action: "created",
    metadata: { kind: created.kind, status: created.status },
  });

  return created;
}

// ============================================================================
// updateAppointment — atualizacao geral (titulo, descricao, channel, etc)
// ============================================================================

export interface UpdateAppointmentInput {
  title?: string;
  description?: string | null;
  lead_id?: string | null;
  service_id?: string | null;
  channel?: AppointmentUpdate["channel"];
  location?: string | null;
  meeting_url?: string | null;
  notes?: string | null;
}

export async function updateAppointment(
  ctx: AgendaMutationContext,
  id: string,
  input: UpdateAppointmentInput,
): Promise<Appointment> {
  const { db, orgId } = ctx;

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.lead_id !== undefined) patch.lead_id = input.lead_id;
  if (input.service_id !== undefined) patch.service_id = input.service_id;
  if (input.channel !== undefined) patch.channel = input.channel;
  if (input.location !== undefined) patch.location = input.location;
  if (input.meeting_url !== undefined) patch.meeting_url = input.meeting_url;
  patch.updated_at = new Date().toISOString();

  if (Object.keys(patch).length === 1) {
    // So updated_at — nada de fato pra atualizar.
    const current = await getAppointment({ db, orgId }, id);
    if (!current) throw new Error("updateAppointment: nao encontrado");
    return current;
  }

  const { data, error } = await db
    .from("appointments")
    .update(patch)
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN_COLUMNS)
    .single();

  if (error) throw new Error(`updateAppointment: ${error.message}`);
  const updated = data as Appointment;

  await insertHistory(ctx, {
    appointment_id: id,
    action: "updated",
    metadata: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
  });

  return updated;
}

// ============================================================================
// updateAppointmentStatus — transicao explicita de status (sem cancel)
// ============================================================================

export async function updateAppointmentStatus(
  ctx: AgendaMutationContext,
  id: string,
  status: AppointmentStatus,
): Promise<Appointment> {
  if (status === "cancelled") {
    throw new AppointmentValidationError(
      "Use cancelAppointment(...) pra cancelar — preserva motivo/autor",
      "status",
    );
  }
  const { db, orgId } = ctx;

  const { data, error } = await db
    .from("appointments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN_COLUMNS)
    .single();

  if (error) throw new Error(`updateAppointmentStatus: ${error.message}`);
  const updated = data as Appointment;

  await insertHistory(ctx, {
    appointment_id: id,
    action: "status_changed",
    metadata: { status },
  });

  return updated;
}

// ============================================================================
// cancelAppointment — preserva motivo, autor, role
// ============================================================================

export interface CancelAppointmentInput {
  reason?: string;
  cancelled_by_role?: CancellationRole;
}

export async function cancelAppointment(
  ctx: AgendaMutationContext,
  id: string,
  input: CancelAppointmentInput = {},
): Promise<Appointment> {
  const { db, orgId, userId } = ctx;
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("appointments")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by_user_id: userId,
      cancelled_by_role: input.cancelled_by_role ?? "agent",
      cancellation_reason: input.reason ?? null,
      updated_at: now,
    })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN_COLUMNS)
    .single();

  if (error) throw new Error(`cancelAppointment: ${error.message}`);
  const updated = data as Appointment;

  await insertHistory(ctx, {
    appointment_id: id,
    action: "cancelled",
    metadata: {
      reason: input.reason ?? null,
      cancelled_by_role: input.cancelled_by_role ?? "agent",
    },
  });

  return updated;
}

// ============================================================================
// rescheduleAppointment — cria NOVO appointment apontando rescheduled_from,
// marca o antigo como 'rescheduled'. Mantem audit trail intacto.
// ============================================================================

export interface RescheduleAppointmentInput {
  new_start_at: string;
  new_end_at: string;
  /** Default: copia do original. */
  new_user_id?: string;
  /** Default true. */
  enforce_conflict_check?: boolean;
}

export async function rescheduleAppointment(
  ctx: AgendaMutationContext,
  id: string,
  input: RescheduleAppointmentInput,
): Promise<{ original: Appointment; replacement: Appointment }> {
  const { db, orgId } = ctx;

  validateTimeWindow(input.new_start_at, input.new_end_at);

  const original = await getAppointment({ db, orgId }, id);
  if (!original) throw new Error("rescheduleAppointment: original nao encontrado");
  if (original.kind !== "appointment") {
    throw new AppointmentValidationError(
      "So 'appointment' pode ser reagendado (event/block usam updateAppointment).",
      "kind",
    );
  }
  if ((BLOCKING_APPOINTMENT_STATUSES as readonly string[]).indexOf(original.status) < 0) {
    throw new AppointmentValidationError(
      `Appointment com status '${original.status}' nao pode ser reagendado.`,
      "status",
    );
  }

  const new_user_id = input.new_user_id ?? original.user_id;
  const new_duration = Math.round(
    (new Date(input.new_end_at).getTime() -
      new Date(input.new_start_at).getTime()) /
      60_000,
  );

  if (input.enforce_conflict_check !== false) {
    await ensureNoConflict(ctx, {
      user_id: new_user_id,
      start_at: input.new_start_at,
      end_at: input.new_end_at,
    });
  }

  const now = new Date().toISOString();

  // 1) Marca original como rescheduled
  const { data: origUpdated, error: origErr } = await db
    .from("appointments")
    .update({ status: "rescheduled", updated_at: now })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN_COLUMNS)
    .single();
  if (origErr) throw new Error(`rescheduleAppointment.original: ${origErr.message}`);

  // 2) Cria replacement
  const { data: replacement, error: newErr } = await db
    .from("appointments")
    .insert({
      organization_id: orgId,
      kind: "appointment",
      title: original.title,
      description: original.description,
      lead_id: original.lead_id,
      user_id: new_user_id,
      service_id: original.service_id,
      booking_page_id: original.booking_page_id,
      start_at: input.new_start_at,
      end_at: input.new_end_at,
      duration_minutes: new_duration,
      timezone: original.timezone,
      status: "awaiting_confirmation",
      channel: original.channel,
      location: original.location,
      meeting_url: original.meeting_url,
      rescheduled_from_id: id,
    })
    .select(RETURN_COLUMNS)
    .single();
  if (newErr) throw new Error(`rescheduleAppointment.new: ${newErr.message}`);

  await insertHistory(ctx, {
    appointment_id: id,
    action: "rescheduled",
    metadata: {
      new_appointment_id: (replacement as Appointment).id,
      new_start_at: input.new_start_at,
      new_end_at: input.new_end_at,
    },
  });

  return {
    original: origUpdated as Appointment,
    replacement: replacement as Appointment,
  };
}

// ============================================================================
// softDeleteAppointment — preserva historico
// ============================================================================

export async function softDeleteAppointment(
  ctx: AgendaMutationContext,
  id: string,
): Promise<void> {
  const { db, orgId } = ctx;
  const now = new Date().toISOString();
  const { error } = await db
    .from("appointments")
    .update({ deleted_at: now, updated_at: now })
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`softDeleteAppointment: ${error.message}`);

  await insertHistory(ctx, {
    appointment_id: id,
    action: "cancelled",
    metadata: { soft_deleted: true },
  });
}

export async function restoreAppointment(
  ctx: AgendaMutationContext,
  id: string,
): Promise<Appointment> {
  const { db, orgId } = ctx;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("appointments")
    .update({ deleted_at: null, updated_at: now })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN_COLUMNS)
    .single();
  if (error) throw new Error(`restoreAppointment: ${error.message}`);

  await insertHistory(ctx, {
    appointment_id: id,
    action: "restored",
    metadata: {},
  });

  return data as Appointment;
}
