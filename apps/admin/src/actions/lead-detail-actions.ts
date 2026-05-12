"use server";

// PR-U1: actions admin pro LeadInfoDrawer (que sera extraido em PR-U2).
// Espelha as actions equivalentes do CRM (apps/crm/src/actions/leads.ts
// + crm.ts + custom-fields.ts + conversations.ts) mas com auth admin
// (requireSuperadminForOrg + service-role). Multi-tenant garantido via
// orgId do cookie.
//
// TODO PR-S5: extrair queries puras pra packages/shared/src/crm/queries
// pra evitar duplicacao de SQL. Por agora replicado pra isolar PR-U1.
// (Queries hoje: getLeadStats, getLeadDealsList, getLeadCustomFields,
//  setLeadCustomFieldValue, findOrCreateConversationByLead.
//  fetchLead, fetchLeadActivities, listDeals etc ja estao em shared.)

import { requireSuperadminForOrg } from "@/lib/auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findLeadOpenDealWithStages } from "@persia/shared/crm";
import type {
  LeadAgentHandoffState,
  LeadCustomFieldEntry,
  LeadDealItem,
  LeadOpenDealWithStages,
  LeadStats,
} from "@persia/leads-ui";

// LooseDb cast pra alguns selects mais ricos onde o Database type
// autogerado nao tem todas as colunas (lead_field_defs em particular).
type LooseDb = { from: (table: string) => any };

export async function getLeadStats(leadId: string): Promise<LeadStats> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Defesa multi-tenant: confirma lead pertence ao org gerenciado
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) {
    return {
      deals: { count: 0, total_value: 0, latest_status: null },
      conversations: { count: 0, last_message_at: null },
      activities: { count: 0, latest_description: null, latest_at: null },
    };
  }

  const [dealsRes, convsRes, activitiesRes] = await Promise.all([
    supabase
      .from("deals")
      .select("value, status, created_at")
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    supabase
      .from("conversations")
      .select("id, last_message_at", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1),
    supabase
      .from("lead_activities")
      .select("description, created_at", { count: "exact" })
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const deals = dealsRes.data ?? [];
  const dealsCount = deals.length;
  const dealsTotal = deals.reduce(
    (sum: number, d: { value?: number | null }) => sum + (d.value ?? 0),
    0,
  );
  const latestDealStatus =
    dealsCount > 0 ? (deals[0] as { status?: string }).status ?? null : null;

  const convsCount = convsRes.count ?? 0;
  const lastMsgAt =
    convsRes.data && convsRes.data.length > 0
      ? ((convsRes.data[0] as { last_message_at?: string | null })
          .last_message_at ?? null)
      : null;

  const activitiesCount = activitiesRes.count ?? 0;
  const latestActivity =
    activitiesRes.data && activitiesRes.data.length > 0
      ? (activitiesRes.data[0] as {
          description?: string | null;
          created_at?: string | null;
        })
      : null;

  return {
    deals: {
      count: dealsCount,
      total_value: dealsTotal,
      latest_status: latestDealStatus,
    },
    conversations: { count: convsCount, last_message_at: lastMsgAt },
    activities: {
      count: activitiesCount,
      latest_description: latestActivity?.description ?? null,
      latest_at: latestActivity?.created_at ?? null,
    },
  };
}

export async function getLeadDealsList(
  leadId: string,
): Promise<LeadDealItem[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Confirma lead pertence ao org gerenciado
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) return [];

  const { data, error } = await supabase
    .from("deals")
    .select(
      `
        id,
        title,
        value,
        status,
        pipeline_id,
        stage_id,
        created_at,
        updated_at,
        pipeline_stages (
          name,
          color,
          outcome
        )
      `,
    )
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  type Row = {
    id: string;
    title: string;
    value: number;
    status: string;
    pipeline_id: string;
    stage_id: string;
    created_at: string;
    updated_at: string | null;
    pipeline_stages: {
      name: string;
      color: string;
      outcome: "em_andamento" | "falha" | "bem_sucedido";
    } | null;
  };

  return (data as unknown as Row[]).map((row) => ({
    id: row.id,
    title: row.title,
    value: row.value,
    status: row.status,
    pipeline_id: row.pipeline_id,
    stage_id: row.stage_id,
    stage_name: row.pipeline_stages?.name ?? "",
    stage_color: row.pipeline_stages?.color ?? "#3b82f6",
    stage_outcome: row.pipeline_stages?.outcome ?? "em_andamento",
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function getLeadOpenDealWithStages(
  leadId: string,
): Promise<LeadOpenDealWithStages | null> {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Reusa query pura do shared
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
  const looseDb = admin as unknown as LooseDb;

  // Lookup defs + valores em paralelo
  const [defsRes, valuesRes] = await Promise.all([
    looseDb
      .from("lead_field_defs")
      .select("id, name, field_key, field_type, options, is_required, sort_order")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true }),
    looseDb
      .from("lead_field_values")
      .select("custom_field_id, value")
      .eq("lead_id", leadId)
      .eq("organization_id", orgId),
  ]);

  type DefRow = {
    id: string;
    name: string;
    field_key: string;
    field_type: string;
    options: string[] | string | null;
    is_required: boolean;
    sort_order: number;
  };
  type ValRow = { custom_field_id: string; value: string };

  const defs = (defsRes.data ?? []) as DefRow[];
  const values = (valuesRes.data ?? []) as ValRow[];

  // Parse options se vier JSONB string
  const parseOptions = (raw: string[] | string | null): string[] => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  return defs.map((def) => {
    const found = values.find((v) => v.custom_field_id === def.id);
    return {
      field: {
        id: def.id,
        name: def.name,
        field_key: def.field_key,
        field_type: def.field_type,
        options: parseOptions(def.options),
        is_required: def.is_required,
        sort_order: def.sort_order,
      },
      value: found?.value ?? "",
    };
  });
}

export async function setLeadCustomFieldValue(
  leadId: string,
  customFieldId: string,
  value: string,
): Promise<{ success: boolean }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const looseDb = admin as unknown as LooseDb;
  const supabase = admin as unknown as SupabaseClient;

  // Defesa: lead + field do mesmo org
  const [{ data: lead }, { data: field }] = await Promise.all([
    supabase
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    looseDb
      .from("lead_field_defs")
      .select("id")
      .eq("id", customFieldId)
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);

  if (!lead) throw new Error("Lead não encontrado nesta organização");
  if (!field) throw new Error("Campo não encontrado nesta organização");

  const trimmed = value.trim();
  if (trimmed === "") {
    // Vazio = remove linha
    const { error } = await looseDb
      .from("lead_field_values")
      .delete()
      .eq("lead_id", leadId)
      .eq("custom_field_id", customFieldId);
    if (error) throw new Error(error.message);
  } else {
    // Upsert (conflict no composite PK: lead_id + custom_field_id)
    const { error } = await looseDb
      .from("lead_field_values")
      .upsert(
        {
          organization_id: orgId,
          lead_id: leadId,
          custom_field_id: customFieldId,
          value: trimmed,
        },
        { onConflict: "lead_id,custom_field_id" },
      );
    if (error) throw new Error(error.message);
  }

  return { success: true };
}

export async function findOrCreateConversationByLead(
  leadId: string,
): Promise<{ conversationId: string; created: boolean }> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Confirma lead pertence ao org gerenciado
  const { data: lead } = await supabase
    .from("leads")
    .select("id, channel")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) throw new Error("Lead não encontrado nesta organização");

  // Find: conversa aberta mais recente
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .in("status", ["active", "waiting_human"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { conversationId: existing.id as string, created: false };
  }

  // Create: admin como assigned_to. CRM agente usa seu userId; aqui
  // assigned_to fica como o user admin (transparencia + audit).
  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      channel: (lead.channel as string) || "whatsapp",
      status: "active",
      assigned_to: userId,
      last_message_at: null,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Erro ao criar conversa");
  }
  return { conversationId: created.id as string, created: true };
}

// === Re-wraps de actions admin existentes pra alinhar com a interface ===
// (CRM throws / admin retorna {data,error} historicamente. Adapter
// abre o envelope e throws pra alinhar com a interface shared.)

export async function getLeadForDrawer(
  leadId: string,
): Promise<{ lead: import("@persia/shared/crm").LeadDetail; activities: import("@persia/shared/crm").LeadActivity[] }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { fetchLead, fetchLeadActivities } = await import("@persia/shared/crm");
  const ctx = { db: admin, orgId };
  const [leadResult, activitiesResult] = await Promise.all([
    fetchLead(ctx, leadId),
    fetchLeadActivities(ctx, leadId, { limit: 50 }),
  ]);
  return { lead: leadResult.lead, activities: activitiesResult };
}

export async function updateLeadForDrawer(
  leadId: string,
  data: import("@persia/shared/crm").UpdateLeadInput,
): Promise<{ id: string }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { updateLead: updateLeadShared } = await import("@persia/shared/crm");
  const updated = await updateLeadShared({ db: admin, orgId }, leadId, data);
  if (!updated) throw new Error("Lead não atualizado");
  return { id: updated.id };
}

export async function deleteLeadForDrawer(
  leadId: string,
): Promise<{ success: boolean }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { deleteLead: deleteLeadShared } = await import("@persia/shared/crm");
  await deleteLeadShared({ db: admin, orgId }, leadId);
  return { success: true };
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
