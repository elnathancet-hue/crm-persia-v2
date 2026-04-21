"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";


export async function getPipelines() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin
    .from("pipelines")
    .select("*, pipeline_stages(*, deals(*))")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  return data || [];
}

export async function createPipeline(name: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: pipeline } = await admin
    .from("pipelines")
    .insert({ organization_id: orgId, name })
    .select()
    .single();

  if (pipeline) {
    const stages = ["Novo", "Contato", "Proposta", "Negociacao", "Fechado"];
    const colors = ["#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#22c55e"];
    for (let i = 0; i < stages.length; i++) {
      await admin.from("pipeline_stages").insert({
        pipeline_id: pipeline.id,
        name: stages[i],
        sort_order: i,
        color: colors[i],
      });
    }
  }
  revalidatePath("/crm");
  return pipeline;
}

export async function createDeal(data: { pipeline_id: string; stage_id: string; title: string; value: number; lead_id?: string }) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate pipeline belongs to active org
  const { data: pipeline } = await admin
    .from("pipelines")
    .select("id")
    .eq("id", data.pipeline_id)
    .eq("organization_id", orgId)
    .single();
  if (!pipeline) return null;

  const { data: deal, error } = await admin
    .from("deals")
    .insert({
      organization_id: orgId,
      pipeline_id: data.pipeline_id,
      stage_id: data.stage_id,
      lead_id: data.lead_id || null,
      title: data.title,
      value: data.value,
    })
    .select()
    .single();
  revalidatePath("/crm");
  if (error) return null;
  return deal;
}

export async function moveDeal(dealId: string, stageId: string, sortOrder: number) {
  const { admin, orgId } = await requireSuperadminForOrg();
  await admin
    .from("deals")
    .update({ stage_id: stageId, sort_order: sortOrder })
    .eq("id", dealId)
    .eq("organization_id", orgId);
  revalidatePath("/crm");
}

export async function deleteDeal(dealId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin
    .from("deals")
    .delete()
    .eq("id", dealId)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/crm");
  return { error: null };
}

export async function createStage(pipelineId: string, name: string, sortOrder: number, color?: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate pipeline belongs to active org
  const { data: pipeline } = await admin
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .single();
  if (!pipeline) return null;

  const { data } = await admin.from("pipeline_stages").insert({
    pipeline_id: pipelineId, name, sort_order: sortOrder, color: color || "#3b82f6",
  }).select().single();
  revalidatePath("/crm");
  return data;
}

export async function updateDealStatus(dealId: string, status: "open" | "won" | "lost") {
  const { admin, orgId } = await requireSuperadminForOrg();
  const now = new Date().toISOString();
  await admin
    .from("deals")
    .update({
      status,
      closed_at: status !== "open" ? now : null,
    })
    .eq("id", dealId)
    .eq("organization_id", orgId);
  revalidatePath("/crm");
}

export async function updateStage(stageId: string, data: { name?: string; color?: string; sort_order?: number }) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate stage belongs to a pipeline in the active org
  const { data: stage } = await admin
    .from("pipeline_stages")
    .select("id, pipelines!inner(organization_id)")
    .eq("id", stageId)
    .eq("pipelines.organization_id", orgId)
    .single();
  if (!stage) return;

  await admin.from("pipeline_stages").update(data).eq("id", stageId);
  revalidatePath("/crm");
}

export async function deleteStage(stageId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate stage belongs to a pipeline in the active org
  const { data: stage } = await admin
    .from("pipeline_stages")
    .select("id, pipelines!inner(organization_id)")
    .eq("id", stageId)
    .eq("pipelines.organization_id", orgId)
    .single();
  if (!stage) return;

  await admin.from("deals").delete().eq("stage_id", stageId);
  await admin.from("pipeline_stages").delete().eq("id", stageId);
  revalidatePath("/crm");
}

export async function deletePipeline(pipelineId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate pipeline belongs to active org
  const { data: pipeline } = await admin
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .single();
  if (!pipeline) return;

  const { data: stages } = await admin.from("pipeline_stages").select("id").eq("pipeline_id", pipelineId);
  if (stages) {
    for (const s of stages) {
      await admin.from("deals").delete().eq("stage_id", s.id);
    }
  }
  await admin.from("pipeline_stages").delete().eq("pipeline_id", pipelineId);
  await admin.from("pipelines").delete().eq("id", pipelineId);
  revalidatePath("/crm");
}
