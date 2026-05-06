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
  listOrgActivities,
  listTags,
  removeTagFromLead as removeTagFromLeadShared,
  updateLead as updateLeadShared,
  type ListOrgActivitiesOptions,
} from "@persia/shared/crm";
import { phoneBROptional, emailOptional } from "@persia/shared/validation";

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

/**
 * PR-K7: timeline global de activities da org pra tab "Atividades"
 * do CRM. Aceita filtros por tipo + lead + paginacao.
 */
export async function getOrgActivities(
  options: ListOrgActivitiesOptions = {},
) {
  const { supabase, orgId } = await requireRole("agent");
  return listOrgActivities({ db: supabase, orgId }, options);
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

/**
 * Cria um lead.
 *
 * PR-A LEADFIX: o auto-deal (que vivia aqui em PR-CRMOPS4) virou
 * trigger de DB (`lead_auto_deal` em migration 035). A garantia
 * "todo lead tem deal no Kanban" agora e invariante de banco —
 * vale pra qualquer caminho de criacao (action, webhook, n8n,
 * booking publico, importacao CSV, futuras integracoes).
 *
 * Aqui ficou apenas: requireRole + createLeadShared (UPSERT por
 * phone) + revalidatePath. O trigger faz o resto.
 */
export async function createLead(formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");
  const ctx = { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) };

  // PR-A LEADFIX: normaliza phone (E.164) e email (lowercase trim)
  // ANTES do createLeadShared. Isso garante que o lookup de
  // duplicidade por phone funciona corretamente — sem isso, lead
  // criado pelo webhook UAZAPI ("+5511987654321") nao casa com lead
  // do form ("(11) 98765-4321") e vira duplicado.
  const rawPhone = fdField(formData, "phone");
  const rawEmail = fdField(formData, "email");

  const phoneResult = phoneBROptional.safeParse(rawPhone ?? undefined);
  if (!phoneResult.success) {
    throw new Error(phoneResult.error.issues[0]?.message ?? "Telefone inválido");
  }
  const emailResult = emailOptional.safeParse(rawEmail ?? undefined);
  if (!emailResult.success) {
    throw new Error("Email inválido");
  }

  const lead = await createLeadShared(ctx, {
    name: fdField(formData, "name"),
    phone: phoneResult.data ?? null,
    email: emailResult.data ?? null,
    source: (fdField(formData, "source") as string) || undefined,
    status: (fdField(formData, "status") as string) || undefined,
    channel: (fdField(formData, "channel") as string) || undefined,
  });

  revalidatePath("/leads");
  revalidatePath("/crm");
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
