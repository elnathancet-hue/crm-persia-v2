"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
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

export async function getAgendaServices(
  filters: ListServicesFilters = {},
): Promise<AgendaService[]> {
  const { supabase, orgId } = await requireRole("agent");
  return listShared(qctx(supabase, orgId), filters);
}

export async function getAgendaServiceById(id: string): Promise<AgendaService | null> {
  const { supabase, orgId } = await requireRole("agent");
  return getShared(qctx(supabase, orgId), id);
}

export async function createAgendaService(
  input: CreateAgendaServiceInput,
): Promise<AgendaService> {
  const { supabase, orgId, userId } = await requireRole("agent");
  const created = await createShared(mctx(supabase, orgId, userId), input);
  revalidatePath("/agenda/servicos");
  return created;
}

export async function updateAgendaService(
  id: string,
  input: UpdateAgendaServiceInput,
): Promise<AgendaService> {
  const { supabase, orgId, userId } = await requireRole("agent");
  const updated = await updateShared(mctx(supabase, orgId, userId), id, input);
  revalidatePath("/agenda/servicos");
  return updated;
}

export async function deleteAgendaService(id: string): Promise<void> {
  const { supabase, orgId, userId } = await requireRole("admin");
  await deleteShared(mctx(supabase, orgId, userId), id);
  revalidatePath("/agenda/servicos");
}
