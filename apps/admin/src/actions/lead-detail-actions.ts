"use server";

// PR-U1: actions admin pro LeadInfoDrawer. Mesma interface que o CRM
// expoe via crmLeadsActions, mas com auth admin (requireSuperadminForOrg
// + service-role). Multi-tenant garantido via orgId do cookie.
//
// PR-S5: queries puras agora vivem em packages/shared/src/crm/queries
// (lead-stats.ts, custom-fields.ts) e mutations/conversations.ts. Aqui
// so wrappa auth + ctx — bem mais enxuto.

import { requireSuperadminForOrg } from "@/lib/auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchLead,
  fetchLeadActivities,
  fetchLeadCustomFields,
  fetchLeadDealsList,
  fetchLeadStats,
  findLeadOpenDealWithStages,
  findOrCreateConversationByLead as findOrCreateConvShared,
  upsertLeadCustomFieldValue,
} from "@persia/shared/crm";
import type {
  LeadAgentHandoffState,
  LeadCustomFieldEntry,
  LeadDealItem,
  LeadOpenDealWithStages,
  LeadStats,
} from "@persia/leads-ui";

export async function getLeadStats(leadId: string): Promise<LeadStats> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return fetchLeadStats({ db: admin, orgId }, leadId);
}

export async function getLeadDealsList(
  leadId: string,
): Promise<LeadDealItem[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return fetchLeadDealsList({ db: admin, orgId }, leadId);
}

export async function getLeadOpenDealWithStages(
  leadId: string,
): Promise<LeadOpenDealWithStages | null> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return findLeadOpenDealWithStages({ db: admin, orgId }, leadId);
}

export async function updateDealStage(
  dealId: string,
  stageId: string,
): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Defesa: confirma deal pertence ao org
  const { data: deal } = await supabase
    .from("deals")
    .select("id, pipeline_id")
    .eq("id", dealId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!deal) throw new Error("Deal não encontrado");

  // Defesa: confirma stage pertence ao mesmo pipeline
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("id", stageId)
    .eq("pipeline_id", deal.pipeline_id)
    .maybeSingle();
  if (!stage) throw new Error("Etapa não encontrada neste funil");

  const { error } = await supabase
    .from("deals")
    .update({ stage_id: stageId })
    .eq("id", dealId);
  if (error) throw new Error(error.message);
}

export async function getLeadCustomFields(
  leadId: string,
): Promise<LeadCustomFieldEntry[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return fetchLeadCustomFields({ db: admin, orgId }, leadId);
}

export async function setLeadCustomFieldValue(
  leadId: string,
  customFieldId: string,
  value: string,
): Promise<{ success: boolean }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return upsertLeadCustomFieldValue(
    { db: admin, orgId },
    leadId,
    customFieldId,
    value,
  );
}

export async function findOrCreateConversationByLead(
  leadId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  return findOrCreateConvShared({ db: admin, orgId }, leadId, userId);
}

// === Re-wraps de actions admin existentes pra alinhar com a interface ===
// (CRM throws / admin retorna {data,error} historicamente. Adapter
// abre o envelope e throws pra alinhar com a interface shared.)

export async function getLeadForDrawer(
  leadId: string,
): Promise<{ lead: import("@persia/shared/crm").LeadDetail; activities: import("@persia/shared/crm").LeadActivity[] }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const ctx = { db: admin, orgId };
  const [leadResult, activitiesResult] = await Promise.all([
    fetchLead(ctx, leadId),
    fetchLeadActivities(ctx, leadId, { limit: 50 }),
  ]);
  return { lead: leadResult.lead, activities: activitiesResult };
}

// Sprint 3b: migrado pra ActionResult — antes lancava em erro.
export async function updateLeadForDrawer(
  leadId: string,
  data: import("@persia/shared/crm").UpdateLeadInput,
): Promise<import("@persia/ui").ActionResult<{ id: string }>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const { updateLead: updateLeadShared } = await import("@persia/shared/crm");
    const updated = await updateLeadShared({ db: admin, orgId }, leadId, data);
    if (!updated) return { error: "Lead não atualizado." };
    return { data: { id: updated.id } };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível atualizar o lead.",
    };
  }
}

export async function deleteLeadForDrawer(
  leadId: string,
): Promise<import("@persia/ui").ActionResult<{ success: true }>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const { deleteLead: deleteLeadShared } = await import("@persia/shared/crm");
    await deleteLeadShared({ db: admin, orgId }, leadId);
    return { data: { success: true as const } };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível excluir o lead.",
    };
  }
}

export async function addTagToLeadForDrawer(
  leadId: string,
  tagId: string,
): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Defesa: lead + tag do mesmo org
  const [{ data: lead }, { data: tag }] = await Promise.all([
    supabase
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("tags")
      .select("id")
      .eq("id", tagId)
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);
  if (!lead) throw new Error("Lead não encontrado nesta organização");
  if (!tag) throw new Error("Tag não encontrada nesta organização");

  const { error } = await supabase
    .from("lead_tags")
    .insert({ lead_id: leadId, tag_id: tagId })
    .select("lead_id")
    .maybeSingle();
  // ignore unique violation (tag ja atribuida) — outros erros throw
  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }
}

export async function removeTagFromLeadForDrawer(
  leadId: string,
  tagId: string,
): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Defesa: lead pertence ao org
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) throw new Error("Lead não encontrado nesta organização");

  const { error } = await supabase
    .from("lead_tags")
    .delete()
    .eq("lead_id", leadId)
    .eq("tag_id", tagId);
  if (error) throw new Error(error.message);
}

// === Agent handoff: normalizar signature (admin pega orgId do cookie,
// nao mais como 1o arg) ===

export async function getLeadAgentHandoffStateForDrawer(
  leadId: string,
): Promise<LeadAgentHandoffState> {
  const { orgId } = await requireSuperadminForOrg();
  const { getLeadAgentHandoffState } = await import(
    "@/actions/ai-agent/reactivate"
  );
  return getLeadAgentHandoffState(orgId, leadId);
}

export async function reactivateLeadAgentForDrawer(
  leadId: string,
): Promise<{ updatedCount: number }> {
  const { orgId } = await requireSuperadminForOrg();
  const { reactivateAgent } = await import("@/actions/ai-agent/reactivate");
  return reactivateAgent(orgId, leadId);
}
