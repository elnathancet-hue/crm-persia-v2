"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  createDeal as createDealShared,
  createPipeline as createPipelineShared,
  createStage as createStageShared,
  deleteDeal as deleteDealShared,
  deletePipeline as deletePipelineShared,
  deleteStage as deleteStageShared,
  listDeals,
  listPipelines,
  listStages,
  moveDealKanban,
  updateDeal as updateDealShared,
  updateDealStatus as updateDealStatusShared,
  updatePipelineName as updatePipelineNameShared,
  updateStage as updateStageShared,
  updateStageOrder as updateStageOrderShared,
} from "@persia/shared/crm";

// Logica de pipelines/stages/deals consolidada em @persia/shared/crm.
// Aqui apenas resolvemos auth (requireRole) e disparamos revalidatePath.

// ============ PIPELINES ============

export async function getPipelines() {
  const { supabase, orgId } = await requireRole("agent");
  return listPipelines({ db: supabase, orgId });
}

export async function createPipeline(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");
  const name = (formData.get("name") as string) || undefined;
  const pipeline = await createPipelineShared({ db: supabase, orgId }, { name });
  revalidatePath("/crm");
  return pipeline;
}

// ============ STAGES ============

export async function getStages(pipelineId: string) {
  const { supabase, orgId } = await requireRole("agent");
  return listStages({ db: supabase, orgId }, pipelineId);
}

export async function createStage(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");
  const stage = await createStageShared(
    { db: supabase, orgId },
    {
      pipelineId: formData.get("pipeline_id") as string,
      name: formData.get("name") as string,
      sortOrder: parseInt(formData.get("sort_order") as string, 10) || 0,
      color: (formData.get("color") as string) || undefined,
    },
  );
  revalidatePath("/crm");
  return stage;
}

export async function updateStageOrder(
  stages: { id: string; position: number }[],
) {
  const { supabase, orgId } = await requireRole("admin");
  await updateStageOrderShared({ db: supabase, orgId }, stages);
  revalidatePath("/crm");
}

export async function updateStage(
  stageId: string,
  data: {
    name?: string;
    color?: string;
    sort_order?: number;
    description?: string | null;
    /** Move a stage entre buckets (em_andamento/falha/bem_sucedido). */
    outcome?: "em_andamento" | "falha" | "bem_sucedido";
  },
) {
  const { supabase, orgId } = await requireRole("admin");
  await updateStageShared({ db: supabase, orgId }, stageId, {
    name: data.name,
    color: data.color,
    sortOrder: data.sort_order,
    description: data.description,
    outcome: data.outcome,
  });
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function deleteStage(stageId: string) {
  const { supabase, orgId } = await requireRole("admin");
  await deleteStageShared({ db: supabase, orgId }, stageId);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function updatePipelineName(pipelineId: string, name: string) {
  const { supabase, orgId } = await requireRole("admin");
  await updatePipelineNameShared({ db: supabase, orgId }, pipelineId, name);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function deletePipeline(pipelineId: string) {
  const { supabase, orgId } = await requireRole("admin");
  await deletePipelineShared({ db: supabase, orgId }, pipelineId);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

// ============ DEALS ============

export async function getDeals(pipelineId?: string) {
  const { supabase, orgId } = await requireRole("agent");
  return listDeals({ db: supabase, orgId }, { pipelineId });
}

/**
 * Retorna o deal aberto mais recente do lead + as stages do pipeline
 * desse deal (pra UI do drawer "Informações do lead" — subheader
 * clicável que troca a etapa atual sem sair da pagina). Se o lead
 * nao tem nenhum deal aberto, retorna null.
 */
export async function getLeadOpenDealWithStages(leadId: string): Promise<{
  deal: { id: string; pipeline_id: string; stage_id: string };
  stages: Array<{
    id: string;
    name: string;
    color: string;
    outcome: "em_andamento" | "falha" | "bem_sucedido";
    sort_order: number;
  }>;
} | null> {
  const { supabase, orgId } = await requireRole("agent");

  const { data: deal } = await supabase
    .from("deals")
    .select("id, pipeline_id, stage_id, status")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!deal) return null;

  const { data: stages, error: stagesErr } = await supabase
    .from("pipeline_stages")
    .select("id, name, color, outcome, sort_order")
    .eq("pipeline_id", deal.pipeline_id)
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (stagesErr) throw new Error(stagesErr.message);

  return {
    deal: {
      id: deal.id as string,
      pipeline_id: deal.pipeline_id as string,
      stage_id: deal.stage_id as string,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stages: (stages ?? []) as any,
  };
}

export async function createDeal(formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");
  const leadIdRaw = formData.get("lead_id") as string;
  const deal = await createDealShared(
    { db: supabase, orgId },
    {
      pipelineId: formData.get("pipeline_id") as string,
      stageId: formData.get("stage_id") as string,
      leadId: leadIdRaw || null,
      title: formData.get("title") as string,
      value: parseFloat((formData.get("value") as string) || "0"),
    },
  );
  revalidatePath("/crm");
  return deal;
}

export async function updateDealStage(dealId: string, stageId: string) {
  const { supabase, orgId } = await requireRole("agent");

  // Movimentacao "rica" — passa por moveDealToStage que tambem dispara
  // activity log + onStageChanged flows + sync UAZAPI. NAO usa
  // moveDealKanban (que e versao leve so pra drag-drop).
  const { moveDealToStage } = await import("@/lib/crm/move-deal");
  const result = await moveDealToStage({
    dealId,
    stageId,
    orgId,
    source: "manual",
    supabase,
  });

  if (!result.ok) throw new Error(result.error || "Erro ao mover deal");

  revalidatePath("/crm");
}

export async function updateDeal(
  dealId: string,
  data: {
    title?: string;
    value?: number;
    status?: string;
    lead_id?: string | null;
  },
) {
  const { supabase, orgId } = await requireRole("agent");
  await updateDealShared({ db: supabase, orgId }, dealId, {
    title: data.title,
    value: data.value,
    status: data.status,
    leadId: data.lead_id,
  });
  revalidatePath("/crm");
}

export async function deleteDeal(dealId: string) {
  const { supabase, orgId } = await requireRole("agent");
  await deleteDealShared({ db: supabase, orgId }, dealId);
  revalidatePath("/crm");
}

// ============ DEAL OPS (used by kanban) ============

export async function moveDeal(
  dealId: string,
  stageId: string,
  sortOrder: number,
) {
  const { supabase, orgId } = await requireRole("agent");
  await moveDealKanban({ db: supabase, orgId }, dealId, stageId, sortOrder);
  revalidatePath("/crm");
}

export async function updateDealStatus(dealId: string, status: string) {
  const { supabase, orgId } = await requireRole("agent");
  await updateDealStatusShared(
    { db: supabase, orgId },
    dealId,
    status as "open" | "won" | "lost",
  );
  revalidatePath("/crm");
}

// ============ LEADS (for deal assignment) ============

export async function getLeads() {
  const { supabase, orgId } = await requireRole("agent");
  const { data, error } = await supabase
    .from("leads")
    .select("id, name, phone, email")
    .eq("organization_id", orgId)
    .order("name", { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);
  return data || [];
}

// ============ AUTO-CREATE DEFAULT PIPELINE ============

export async function ensureDefaultPipeline() {
  const { supabase, orgId } = await requireRole("agent");

  const { data: existing } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1)
    .single();

  if (existing) return existing.id;

  // Cria pipeline default + stages padrao via shared mutation
  const pipeline = await createPipelineShared({ db: supabase, orgId }, {});
  revalidatePath("/crm");
  return pipeline.id;
}
