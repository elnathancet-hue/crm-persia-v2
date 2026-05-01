"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import {
  cancelAppointment as cancelShared,
  createAppointment as createShared,
  getAppointment as getShared,
  listAppointments as listShared,
  rescheduleAppointment as rescheduleShared,
  restoreAppointment as restoreShared,
  softDeleteAppointment as softDeleteShared,
  updateAppointment as updateShared,
  updateAppointmentStatus as updateStatusShared,
  type AgendaMutationContext,
  type AgendaQueryContext,
  type Appointment,
  type AppointmentStatus,
  type CancelAppointmentInput,
  type CreateAppointmentInput,
  type ListAppointmentsFilters,
  type RescheduleAppointmentInput,
  type UpdateAppointmentInput,
} from "@persia/shared/agenda";

// Re-export do tipo canonico pra UI consumir.
export type { Appointment };

function buildQueryCtx(
  supabase: unknown,
  orgId: string,
): AgendaQueryContext {
  return { db: supabase as AgendaQueryContext["db"], orgId };
}

function buildMutationCtx(
  supabase: unknown,
  orgId: string,
  userId: string,
  performedByRole: AgendaMutationContext["performedByRole"] = "agent",
): AgendaMutationContext {
  return {
    db: supabase as AgendaMutationContext["db"],
    orgId,
    userId,
    performedByRole,
  };
}

// ============================================================================
// Read
// ============================================================================

export async function getAppointments(
  filters: ListAppointmentsFilters = {},
): Promise<Appointment[]> {
  const { supabase, orgId } = await requireRole("agent");
  return listShared(buildQueryCtx(supabase, orgId), filters);
}

export async function getAppointmentById(id: string): Promise<Appointment | null> {
  const { supabase, orgId } = await requireRole("agent");
  return getShared(buildQueryCtx(supabase, orgId), id);
}

// ============================================================================
// Write
// ============================================================================

export async function createAppointment(
  input: Omit<CreateAppointmentInput, "user_id"> & { user_id?: string },
): Promise<Appointment> {
  const { supabase, orgId, userId, role } = await requireRole("agent");
  // Default user_id = quem ta criando (pra appointment pessoal/avulso).
  const final: CreateAppointmentInput = {
    ...input,
    user_id: input.user_id ?? userId,
  };
  const created = await createShared(
    buildMutationCtx(supabase, orgId, userId, role === "viewer" ? "agent" : role),
    final,
  );
  revalidatePath("/agenda");
  return created;
}

export async function updateAppointment(
  id: string,
  input: UpdateAppointmentInput,
): Promise<Appointment> {
  const { supabase, orgId, userId, role } = await requireRole("agent");
  const updated = await updateShared(
    buildMutationCtx(supabase, orgId, userId, role === "viewer" ? "agent" : role),
    id,
    input,
  );
  revalidatePath("/agenda");
  revalidatePath(`/agenda/${id}`);
  return updated;
}

export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<Appointment> {
  const { supabase, orgId, userId, role } = await requireRole("agent");
  const updated = await updateStatusShared(
    buildMutationCtx(supabase, orgId, userId, role === "viewer" ? "agent" : role),
    id,
    status,
  );
  revalidatePath("/agenda");
  return updated;
}

export async function cancelAppointment(
  id: string,
  input: CancelAppointmentInput = {},
): Promise<Appointment> {
  const { supabase, orgId, userId, role } = await requireRole("agent");
  const updated = await cancelShared(
    buildMutationCtx(supabase, orgId, userId, role === "viewer" ? "agent" : role),
    id,
    input,
  );
  revalidatePath("/agenda");
  return updated;
}

export async function rescheduleAppointment(
  id: string,
  input: RescheduleAppointmentInput,
): Promise<{ original: Appointment; replacement: Appointment }> {
  const { supabase, orgId, userId, role } = await requireRole("agent");
  const result = await rescheduleShared(
    buildMutationCtx(supabase, orgId, userId, role === "viewer" ? "agent" : role),
    id,
    input,
  );
  revalidatePath("/agenda");
  return result;
}

export async function deleteAppointment(id: string): Promise<void> {
  // Soft delete por default (preserva audit trail). Hard delete fica
  // restrito a admin/owner via uma action separada se precisar.
  const { supabase, orgId, userId, role } = await requireRole("agent");
  await softDeleteShared(
    buildMutationCtx(supabase, orgId, userId, role === "viewer" ? "agent" : role),
    id,
  );
  revalidatePath("/agenda");
}

export async function restoreAppointment(id: string): Promise<Appointment> {
  const { supabase, orgId, userId, role } = await requireRole("admin");
  const restored = await restoreShared(
    buildMutationCtx(supabase, orgId, userId, role === "viewer" ? "admin" : role),
    id,
  );
  revalidatePath("/agenda");
  return restored;
}
