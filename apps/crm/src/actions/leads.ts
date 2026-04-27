"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type {
  LeadActivity,
  LeadDetail,
  LeadFilters,
  LeadWithTags,
  UpdateLeadInput,
} from "@persia/shared/crm";
import {
  addTagToLead as addTagToLeadShared,
  createLead as createLeadShared,
  deleteLead as deleteLeadShared,
  fetchLead,
  listLeads,
  listTags,
  removeTagFromLead as removeTagFromLeadShared,
  updateLead as updateLeadShared,
} from "@persia/shared/crm";

// Re-exporta tipos canônicos. Fonte da verdade: @persia/shared/crm.
export type { LeadActivity, LeadDetail, LeadFilters, LeadWithTags };

// Helper: callback fire-and-forget que sincroniza o lead com UAZAPI
// apos qualquer mudanca. Carregado dinamicamente pra nao puxar o
// modulo de sync no bundle das paginas que so leem leads.
function makeOnLeadChanged(orgId: string) {
  return (leadId: string) => {
    import("@/lib/whatsapp/sync")
      .then(({ syncLeadToUazapi }) => syncLeadToUazapi(orgId, leadId))
      .catch((err) => console.error("[lead-action] sync error:", err));
  };
}

// ============================================================================
// Queries (read-only) — thin wrappers em volta de @persia/shared/crm
// ============================================================================

export async function getLeads(filters: LeadFilters = {}) {
  const { supabase, orgId } = await requireRole("agent");
  return listLeads({ db: supabase, orgId }, filters);
}

export async function getLead(id: string) {
  const { supabase, orgId } = await requireRole("agent");
  return fetchLead({ db: supabase, orgId }, id);
}

export async function getOrgTags() {
  const { supabase, orgId } = await requireRole("agent");
  return listTags({ db: supabase, orgId }, { orderBy: "name" });
}

// ============================================================================
// Mutations — thin wrappers que injetam onLeadChanged + revalidatePath
// ============================================================================

// Helper: extrai valor do FormData distinguindo "campo não enviado"
// (`undefined`) de "campo enviado vazio" (`null`). FormData.get sempre
// retorna `null` pra keys ausentes, o que perde essa distincao — usamos
// `has` antes pra preservar a semantica do PATCH (so altera campos
// efetivamente enviados).
function fdField(formData: FormData, key: string): string | null | undefined {
  if (!formData.has(key)) return undefined;
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

export async function createLead(formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");
  const lead = await createLeadShared(
    { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
    {
      name: fdField(formData, "name"),
      phone: fdField(formData, "phone"),
      email: fdField(formData, "email"),
      source: (fdField(formData, "source") as string) || undefined,
      status: (fdField(formData, "status") as string) || undefined,
      channel: (fdField(formData, "channel") as string) || undefined,
    },
  );
  revalidatePath("/leads");
  return lead;
}

/**
 * Atualiza um lead. Aceita FormData (form basico do /leads/[id]/edit)
 * OU um objeto `UpdateLeadInput` (drawer "Informações do lead", Fase 2,
 * com endereço/notas/responsável/website).
 */
export async function updateLead(
  id: string,
  data: FormData | UpdateLeadInput,
) {
  const { supabase, orgId } = await requireRole("agent");
  const ctx = { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) };

  const input: UpdateLeadInput =
    data instanceof FormData
      ? {
          name: fdField(data, "name"),
          phone: fdField(data, "phone"),
          email: fdField(data, "email"),
          source: (fdField(data, "source") as string) || undefined,
          status: (fdField(data, "status") as string) || undefined,
          channel: (fdField(data, "channel") as string) || undefined,
        }
      : data;

  const updated = await updateLeadShared(ctx, id, input);
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/crm");
  return updated;
}

export async function deleteLead(id: string) {
  const { supabase, orgId } = await requireRole("agent");
  await deleteLeadShared({ db: supabase, orgId }, id);
  revalidatePath("/leads");
  return { success: true };
}

export async function addTagToLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");
  await addTagToLeadShared(
    { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
    leadId,
    tagId,
  );
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/crm");
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");
  await removeTagFromLeadShared(
    { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
    leadId,
    tagId,
  );
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/crm");
}
