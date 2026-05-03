"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadminForOrg } from "@/lib/auth";
import {
  createAvailabilityRule as createShared,
  deleteAvailabilityRule as deleteShared,
  getAvailabilityRule as getShared,
  getDefaultAvailabilityRule as getDefaultShared,
  listAvailabilityRules as listShared,
  updateAvailabilityRule as updateShared,
  type AgendaMutationContext,
  type AgendaQueryContext,
  type AvailabilityRule,
  type CreateAvailabilityRuleInput,
  type UpdateAvailabilityRuleInput,
} from "@persia/shared/agenda";

export type { AvailabilityRule };

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

export async function getAvailabilityRules(
  filters: { user_id?: string } = {},
): Promise<AvailabilityRule[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return listShared(qctx(admin, orgId), filters);
}

export async function getAvailabilityRuleById(
  id: string,
): Promise<AvailabilityRule | null> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return getShared(qctx(admin, orgId), id);
}

export async function getDefaultAvailabilityRule(
  user_id?: string,
): Promise<AvailabilityRule | null> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  // Admin sem user_id explicito cai no proprio (raro — admin normalmente
  // quer ver disponibilidade de um agente especifico).
  return getDefaultShared(qctx(admin, orgId), user_id ?? userId);
}

export async function createAvailabilityRule(
  input: Omit<CreateAvailabilityRuleInput, "user_id"> & { user_id?: string },
): Promise<AvailabilityRule> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  // Admin precisa especificar user_id (sem 'self' default).
  const target_user = input.user_id ?? userId;
  const created = await createShared(mctx(admin, orgId, userId), {
    ...input,
    user_id: target_user,
  });
  revalidatePath(`/clients/${orgId}/agenda`);
  return created;
}

export async function updateAvailabilityRule(
  id: string,
  input: UpdateAvailabilityRuleInput,
): Promise<AvailabilityRule> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const updated = await updateShared(mctx(admin, orgId, userId), id, input);
  revalidatePath(`/clients/${orgId}/agenda`);
  return updated;
}

export async function deleteAvailabilityRule(id: string): Promise<void> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  await deleteShared(mctx(admin, orgId, userId), id);
  revalidatePath(`/clients/${orgId}/agenda`);
}
