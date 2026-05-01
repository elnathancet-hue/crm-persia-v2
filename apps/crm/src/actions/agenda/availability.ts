"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
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

function qctx(supabase: unknown, orgId: string): AgendaQueryContext {
  return { db: supabase as AgendaQueryContext["db"], orgId };
}

function mctx(
  supabase: unknown,
  orgId: string,
  userId: string,
): AgendaMutationContext {
  return {
    db: supabase as AgendaMutationContext["db"],
    orgId,
    userId,
    performedByRole: "agent",
  };
}

export async function getAvailabilityRules(
  filters: { user_id?: string } = {},
): Promise<AvailabilityRule[]> {
  const { supabase, orgId, userId, role } = await requireRole("agent");
  // Agent so ve as proprias regras (RLS ja garante mas explicita).
  const final =
    role === "agent" && !filters.user_id ? { user_id: userId } : filters;
  return listShared(qctx(supabase, orgId), final);
}

export async function getAvailabilityRuleById(
  id: string,
): Promise<AvailabilityRule | null> {
  const { supabase, orgId } = await requireRole("agent");
  return getShared(qctx(supabase, orgId), id);
}

export async function getDefaultAvailabilityRule(
  user_id?: string,
): Promise<AvailabilityRule | null> {
  const { supabase, orgId, userId } = await requireRole("agent");
  return getDefaultShared(qctx(supabase, orgId), user_id ?? userId);
}

export async function createAvailabilityRule(
  input: Omit<CreateAvailabilityRuleInput, "user_id"> & { user_id?: string },
): Promise<AvailabilityRule> {
  const { supabase, orgId, userId, role } = await requireRole("agent");
  // Agent so cria pra ele mesmo. Admin/owner pode escolher.
  const target_user =
    role === "agent" ? userId : input.user_id ?? userId;
  const created = await createShared(mctx(supabase, orgId, userId), {
    ...input,
    user_id: target_user,
  });
  revalidatePath("/agenda/disponibilidade");
  return created;
}

export async function updateAvailabilityRule(
  id: string,
  input: UpdateAvailabilityRuleInput,
): Promise<AvailabilityRule> {
  const { supabase, orgId, userId } = await requireRole("agent");
  const updated = await updateShared(mctx(supabase, orgId, userId), id, input);
  revalidatePath("/agenda/disponibilidade");
  return updated;
}

export async function deleteAvailabilityRule(id: string): Promise<void> {
  const { supabase, orgId, userId } = await requireRole("agent");
  await deleteShared(mctx(supabase, orgId, userId), id);
  revalidatePath("/agenda/disponibilidade");
}
