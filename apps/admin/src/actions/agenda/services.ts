"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadminForOrg } from "@/lib/auth";
import {
  createAgendaService as createShared,
  deleteAgendaService as deleteShared,
  getAgendaService as getShared,
  listAgendaServices as listShared,
  updateAgendaService as updateShared,
  type AgendaMutationContext,
  type AgendaQueryContext,
  type AgendaService,
  type CreateAgendaServiceInput,
  type ListServicesFilters,
  type UpdateAgendaServiceInput,
} from "@persia/shared/agenda";

export type { AgendaService };

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

export async function getAgendaServices(
  filters: ListServicesFilters = {},
): Promise<AgendaService[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return listShared(qctx(admin, orgId), filters);
}

export async function getAgendaServiceById(
  id: string,
): Promise<AgendaService | null> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return getShared(qctx(admin, orgId), id);
}

export async function createAgendaService(
  input: CreateAgendaServiceInput,
): Promise<AgendaService> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const created = await createShared(mctx(admin, orgId, userId), input);
  revalidatePath(`/clients/${orgId}/agenda`);
  return created;
}

export async function updateAgendaService(
  id: string,
  input: UpdateAgendaServiceInput,
): Promise<AgendaService> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const updated = await updateShared(mctx(admin, orgId, userId), id, input);
  revalidatePath(`/clients/${orgId}/agenda`);
  return updated;
}

export async function deleteAgendaService(id: string): Promise<void> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  await deleteShared(mctx(admin, orgId, userId), id);
  revalidatePath(`/clients/${orgId}/agenda`);
}
