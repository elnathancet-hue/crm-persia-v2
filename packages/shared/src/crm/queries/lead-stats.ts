// PR-S5: queries puras pro drawer "Informacoes do lead".
//
// Antes: SQL replicado entre apps/crm/src/actions/leads.ts e
// apps/admin/src/actions/lead-detail-actions.ts (2x cada).
// Agora: 1 implementacao aqui, ambos apps reusam.
//
// Multi-tenant: `.eq("organization_id", orgId)` explicito em cada
// .from() — funciona pros 2 caminhos (CRM com RLS + admin com
// service-role que bypassa RLS). Defesa em camada.

import type { CrmQueryContext } from "./context";

export interface LeadStats {
  deals: {
    count: number;
    total_value: number;
    latest_status: string | null;
  };
  conversations: {
    count: number;
    last_message_at: string | null;
  };
  activities: {
    count: number;
    latest_description: string | null;
    latest_at: string | null;
  };
}

/**
 * Stats agregados pros 3 cards do header do LeadInfoDrawer.
 * 3 queries paralelas (deals + conversations + activities).
 */
export async function fetchLeadStats(
  ctx: CrmQueryContext,
  leadId: string,
): Promise<LeadStats> {
  const { db, orgId } = ctx;

  // Defesa multi-tenant: confirma lead pertence ao org
  const { data: lead } = await db
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
    db
      .from("deals")
      .select("value, status, created_at")
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    db
      .from("conversations")
      .select("id, last_message_at", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1),
    db
      .from("lead_activities")
      .select("description, created_at", { count: "exact" })
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const deals = (dealsRes.data ?? []) as {
    value?: number | null;
    status?: string;
  }[];
  const dealsCount = deals.length;
  const dealsTotal = deals.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const latestDealStatus =
    dealsCount > 0 ? deals[0].status ?? null : null;

  const convsCount = (convsRes.count as number | null) ?? 0;
  const lastMsgAt =
    convsRes.data && convsRes.data.length > 0
      ? ((convsRes.data[0] as { last_message_at?: string | null })
          .last_message_at ?? null)
      : null;

  const activitiesCount = (activitiesRes.count as number | null) ?? 0;
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

export interface LeadDealItem {
  id: string;
  title: string;
  value: number;
  status: string;
  pipeline_id: string;
  stage_id: string;
  stage_name: string;
  stage_color: string;
  stage_outcome: "em_andamento" | "falha" | "bem_sucedido";
  created_at: string;
  updated_at: string | null;
}

/**
 * Lista de deals (negocios) do lead pra tab Negocios do drawer.
 * Embed das stages via JOIN (1 query, sem N+1).
 *
 * Ordenacao: created_at DESC (mais recente primeiro).
 * Status: retorna todos (open/won/lost/archived) — UI filtra.
 */
export async function fetchLeadDealsList(
  ctx: CrmQueryContext,
  leadId: string,
): Promise<LeadDealItem[]> {
  const { db, orgId } = ctx;

  // Defesa multi-tenant
  const { data: lead } = await db
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) return [];

  const { data, error } = await db
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
