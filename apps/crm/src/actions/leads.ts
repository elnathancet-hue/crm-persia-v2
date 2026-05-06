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
  createDeal as createDealShared,
  createLead as createLeadShared,
  deleteLead as deleteLeadShared,
  fetchLead,
  getDefaultPipelineStage,
  listLeads,
  listOrgActivities,
  listTags,
  removeTagFromLead as removeTagFromLeadShared,
  updateLead as updateLeadShared,
  type ListOrgActivitiesOptions,
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
 * PR-CRMOPS4: tambem cria um DEAL automatico vinculado ao lead, no
 * primeiro pipeline + primeira stage "em_andamento" da org. Garante
 * que o lead aparece no Kanban (Pipeline) imediatamente. Antes desse
 * fix, leads criados pela tab "Leads" ficavam orfaos — visiveis em
 * /crm?tab=leads mas invisiveis no /crm?tab=pipeline.
 *
 * Se a org nao tem pipeline OU nao tem stage em_andamento (config
 * quebrada), cria so o lead e loga warning. Idempotency do upsert do
 * createLeadShared (por phone) eh preservada — se lead ja existe,
 * NAO cria deal duplicado.
 */
export async function createLead(formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");
  const ctx = { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) };

  const lead = await createLeadShared(ctx, {
    name: fdField(formData, "name"),
    phone: fdField(formData, "phone"),
    email: fdField(formData, "email"),
    source: (fdField(formData, "source") as string) || undefined,
    status: (fdField(formData, "status") as string) || undefined,
    channel: (fdField(formData, "channel") as string) || undefined,
  });

  // PR-CRMOPS4: cria deal automatico se o lead nao tem deal ainda.
  // `createLeadShared` faz UPSERT por phone — se phone ja existia,
  // retorna o lead pre-existente (que pode ja ter deals). Pra nao
  // duplicar, checamos antes de criar.
  try {
    const { data: existingDeals } = await supabase
      .from("deals")
      .select("id")
      .eq("organization_id", orgId)
      .eq("lead_id", lead.id)
      .limit(1);

    if (!existingDeals || existingDeals.length === 0) {
      const defaults = await getDefaultPipelineStage(ctx);
      if (defaults) {
        await createDealShared(ctx, {
          pipelineId: defaults.pipelineId,
          stageId: defaults.stageId,
          leadId: lead.id,
          title: (fdField(formData, "name") as string)?.trim() || "Novo lead",
          value: 0,
        });
      } else {
        console.warn(
          "[createLead] Sem default pipeline/stage — lead criado sem deal:",
          lead.id,
        );
      }
    }
  } catch (err) {
    // Erro na criacao do deal NAO falha o lead — loga e segue.
    // O usuario sempre pode adicionar manualmente depois.
    console.error("[createLead] auto-deal falhou:", err);
  }

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
