"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadminForOrg } from "@/lib/auth";
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

export type { Appointment };

function qctx(admin: unknown, orgId: string): AgendaQueryContext {
  return { db: admin as AgendaQueryContext["db"], orgId };
}

function mctx(
  admin: unknown,
  orgId: string,
  userId: string,
): AgendaMutationContext {
  return {
    db: admin as AgendaMutationContext["db"],
    orgId,
    userId,
    performedByRole: "admin",
  };
}

export async function getAppointments(
  filters: ListAppointmentsFilters = {},
): Promise<Appointment[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return listShared(qctx(admin, orgId), filters);
}

export async function getAppointmentById(
  id: string,
): Promise<Appointment | null> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return getShared(qctx(admin, orgId), id);
}

export async function createAppointment(
  input: Omit<CreateAppointmentInput, "user_id"> & { user_id?: string },
): Promise<Appointment> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  // Admin sempre precisa especificar user_id (nao tem 'self' default).
  // Se nao vier, atribui ao userId do superadmin (raro — admin ageria
  // sempre por um usuario da org).
  const final: CreateAppointmentInput = {
    ...input,
    user_id: input.user_id ?? userId,
  };
  const created = await createShared(mctx(admin, orgId, userId), final);
  revalidatePath(`/clients/${orgId}/agenda`);
  return created;
}

export async function updateAppointment(
  id: string,
  input: UpdateAppointmentInput,
): Promise<Appointment> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const updated = await updateShared(mctx(admin, orgId, userId), id, input);
  revalidatePath(`/clients/${orgId}/agenda`);
  return updated;
}

export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<Appointment> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const updated = await updateStatusShared(
    mctx(admin, orgId, userId),
    id,
    status,
  );
  revalidatePath(`/clients/${orgId}/agenda`);
  return updated;
}

export async function cancelAppointment(
  id: string,
  input: CancelAppointmentInput = {},
): Promise<Appointment> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const updated = await cancelShared(mctx(admin, orgId, userId), id, input);
  revalidatePath(`/clients/${orgId}/agenda`);
  return updated;
}

export async function rescheduleAppointment(
  id: string,
  input: RescheduleAppointmentInput,
): Promise<{ original: Appointment; replacement: Appointment }> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const result = await rescheduleShared(mctx(admin, orgId, userId), id, input);
  revalidatePath(`/clients/${orgId}/agenda`);
  return result;
}

export async function deleteAppointment(id: string): Promise<void> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  await softDeleteShared(mctx(admin, orgId, userId), id);
  revalidatePath(`/clients/${orgId}/agenda`);
}

export async function restoreAppointment(id: string): Promise<Appointment> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const restored = await restoreShared(mctx(admin, orgId, userId), id);
  revalidatePath(`/clients/${orgId}/agenda`);
  return restored;
}
