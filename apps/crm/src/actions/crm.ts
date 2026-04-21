"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

// ============ PIPELINES ============

export async function getPipelines() {
  const { supabase, orgId } = await requireRole("agent");
  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createPipeline(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");
  const name = (formData.get("name") as string) || "Funil Principal";

  const { data: pipeline, error } = await supabase
    .from("pipelines")
    .insert({ organization_id: orgId, name })
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (pipeline) {
    const defaultStages = [
      { name: "Novo", color: "#3b82f6" },
      { name: "Contato", color: "#f59e0b" },
      { name: "Qualificado", color: "#8b5cf6" },
      { name: "Proposta", color: "#ef4444" },
      { name: "Fechado", color: "#22c55e" },
    ];

    for (let i = 0; i < defaultStages.length; i++) {
      await supabase.from("pipeline_stages").insert({
        pipeline_id: pipeline.id,
        organization_id: orgId,
        name: defaultStages[i].name,
        sort_order: i,
        color: defaultStages[i].color,
      });
    }
  }

  revalidatePath("/crm");
  return pipeline;
}

// ============ STAGES ============

export async function getStages(pipelineId: string) {
  const { supabase, orgId } = await requireRole("agent");
  // Validate pipeline belongs to the user's org before returning stages
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!pipeline) return [];

  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createStage(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");
  const pipelineId = formData.get("pipeline_id") as string;
  const name = formData.get("name") as string;
  const sortOrder = parseInt(formData.get("sort_order") as string, 10) || 0;
  const color = (formData.get("color") as string) || "#6366f1";

  const { data, error } = await supabase
    .from("pipeline_stages")
    .insert({
      pipeline_id: pipelineId,
      organization_id: orgId,
      name,
      sort_order: sortOrder,
      color,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
  return data;
}

export async function updateStageOrder(stages: { id: string; position: number }[]) {
  const { supabase, orgId } = await requireRole("admin");

  for (const stage of stages) {
    await supabase
      .from("pipeline_stages")
      .update({ sort_order: stage.position })
      .eq("id", stage.id)
      .eq("organization_id", orgId);
  }

  revalidatePath("/crm");
}

export async function updateStage(
  stageId: string,
  data: { name?: string; color?: string; sort_order?: number; description?: string | null }
) {
  const { supabase, orgId } = await requireRole("admin");
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.color !== undefined) updateData.color = data.color;
  if (data.sort_order !== undefined) updateData.sort_order = data.sort_order;
  if (data.description !== undefined) updateData.description = data.description;

  const { error } = await supabase
    .from("pipeline_stages")
    .update(updateData as never)
    .eq("id", stageId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function deleteStage(stageId: string) {
  const { supabase, orgId } = await requireRole("admin");

  // Move deals from this stage to null or delete them
  await supabase
    .from("deals")
    .delete()
    .eq("stage_id", stageId)
    .eq("organization_id", orgId);

  const { error } = await supabase
    .from("pipeline_stages")
    .delete()
    .eq("id", stageId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function updatePipelineName(pipelineId: string, name: string) {
  const { supabase, orgId } = await requireRole("admin");
  const { error } = await supabase
    .from("pipelines")
    .update({ name })
    .eq("id", pipelineId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function deletePipeline(pipelineId: string) {
  const { supabase, orgId } = await requireRole("admin");

  // Cascade: delete deals in each stage, then stages, then the pipeline itself
  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId);

  if (stages) {
    for (const stage of stages) {
      await supabase.from("deals").delete().eq("stage_id", stage.id);
    }
  }

  await supabase.from("pipeline_stages").delete().eq("pipeline_id", pipelineId);

  const { error } = await supabase
    .from("pipelines")
    .delete()
    .eq("id", pipelineId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

// ============ DEALS ============

export async function getDeals(pipelineId?: string) {
  const { supabase, orgId } = await requireRole("agent");

  let query = supabase
    .from("deals")
    .select("*, leads(id, name, phone, email, status, lead_tags(tags(id, name, color)))")
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (pipelineId) {
    query = query.eq("pipeline_id", pipelineId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createDeal(formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("deals")
    .insert({
      organization_id: orgId,
      pipeline_id: formData.get("pipeline_id") as string,
      stage_id: formData.get("stage_id") as string,
      lead_id: (formData.get("lead_id") as string) || null,
      title: formData.get("title") as string,
      value: parseFloat((formData.get("value") as string) || "0"),
      status: "open",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
  return data;
}

export async function updateDealStage(dealId: string, stageId: string) {
  const { supabase, orgId } = await requireRole("agent");

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
  data: { title?: string; value?: number; status?: string; lead_id?: string | null }
) {
  const { supabase, orgId } = await requireRole("agent");

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.value !== undefined) updateData.value = data.value;
  if (data.status !== undefined) {
    updateData.status = data.status;
    if (data.status !== "open") {
      updateData.closed_at = new Date().toISOString();
    } else {
      updateData.closed_at = null;
    }
  }
  if (data.lead_id !== undefined) updateData.lead_id = data.lead_id;

  const { error } = await supabase
    .from("deals")
    .update(updateData as never)
    .eq("id", dealId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
}

export async function deleteDeal(dealId: string) {
  const { supabase, orgId } = await requireRole("agent");
  const { error } = await supabase
    .from("deals")
    .delete()
    .eq("id", dealId)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  revalidatePath("/crm");
}

// ============ DEAL OPS (used by kanban) ============

export async function moveDeal(dealId: string, stageId: string, sortOrder: number) {
  const { supabase, orgId } = await requireRole("agent");
  await supabase
    .from("deals")
    .update({ stage_id: stageId, sort_order: sortOrder })
    .eq("id", dealId)
    .eq("organization_id", orgId);
  revalidatePath("/crm");
}

export async function updateDealStatus(dealId: string, status: string) {
  const { supabase, orgId } = await requireRole("agent");
  await supabase
    .from("deals")
    .update({
      status,
      closed_at: status !== "open" ? new Date().toISOString() : null,
    })
    .eq("id", dealId)
    .eq("organization_id", orgId);
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

  // Create default pipeline
  const { data: pipeline } = await supabase
    .from("pipelines")
    .insert({ organization_id: orgId, name: "Funil Principal" })
    .select()
    .single();

  if (!pipeline) return null;

  const defaultStages = [
    { name: "Novo", color: "#3b82f6" },
    { name: "Contato", color: "#f59e0b" },
    { name: "Qualificado", color: "#8b5cf6" },
    { name: "Proposta", color: "#ef4444" },
    { name: "Fechado", color: "#22c55e" },
  ];

  for (let i = 0; i < defaultStages.length; i++) {
    await supabase.from("pipeline_stages").insert({
      pipeline_id: pipeline.id,
      organization_id: orgId,
      name: defaultStages[i].name,
      sort_order: i,
      color: defaultStages[i].color,
    });
  }

  revalidatePath("/crm");
  return pipeline.id;
}
