"use server";

import type {
  AgentStage,
  CreateStageInput,
  ReorderStagesInput,
  UpdateStageInput,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import type { AgentDb } from "@/lib/ai-agent/db";
import {
  assertConfigBelongsToOrg,
  assertStageBelongsToOrg,
  normalizeStageInput,
  normalizeStagePatch,
  requireAgentRole,
  validateReorder,
} from "./utils";

export async function listStages(configId: string): Promise<AgentStage[]> {
  const { db, orgId } = await requireAgentRole("agent");
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await db
    .from("agent_stages")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("order_index", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentStage[];
}

export async function createStage(
  configId: string,
  input: CreateStageInput,
): Promise<AgentStage> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, configId);
  const normalized = normalizeStageInput(input);

  const orderIndex =
    normalized.order_index ??
    await nextStageOrderIndex(db, orgId, configId);

  const { data, error } = await db
    .from("agent_stages")
    .insert({
      organization_id: orgId,
      config_id: configId,
      slug: normalized.slug,
      order_index: orderIndex,
      situation: normalized.situation,
      instruction: normalized.instruction,
      transition_hint: normalized.transition_hint ?? null,
      rag_enabled: normalized.rag_enabled ?? false,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar etapa");
  const stage = data as AgentStage;
  await enableDefaultStopTool(db, orgId, configId, stage.id);

  revalidatePath(`/dashboard/agents/${configId}`);
  return stage;
}

export async function updateStage(
  stageId: string,
  input: UpdateStageInput,
): Promise<AgentStage> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertStageBelongsToOrg(db, orgId, stageId);
  await assertConfigBelongsToOrg(db, orgId, existing.config_id);
  const patch = normalizeStagePatch(input);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.situation !== undefined) updates.situation = patch.situation;
  if (patch.instruction !== undefined) updates.instruction = patch.instruction;
  if (patch.transition_hint !== undefined) updates.transition_hint = patch.transition_hint || null;
  if (patch.rag_enabled !== undefined) updates.rag_enabled = patch.rag_enabled;
  if (patch.order_index !== undefined) updates.order_index = patch.order_index;
  if (patch.slug !== undefined) updates.slug = patch.slug;

  const { data, error } = await db
    .from("agent_stages")
    .update(updates)
    .eq("organization_id", orgId)
    .eq("id", stageId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao atualizar etapa");
  revalidatePath(`/dashboard/agents/${existing.config_id}`);
  return data as AgentStage;
}

export async function deleteStage(stageId: string): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertStageBelongsToOrg(db, orgId, stageId);

  const { error } = await db
    .from("agent_stages")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", stageId);

  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/agents/${existing.config_id}`);
}

export async function reorderStages(input: ReorderStagesInput): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  const normalized = validateReorder(input);
  await assertConfigBelongsToOrg(db, orgId, normalized.config_id);

  const { data: stages, error } = await db
    .from("agent_stages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("config_id", normalized.config_id);

  if (error) throw new Error(error.message);
  const knownStageIds = new Set((stages ?? []).map((stage: { id: string }) => stage.id));
  const requestedStageIds = new Set(normalized.stage_ids);
  if (knownStageIds.size !== requestedStageIds.size) {
    throw new Error("Lista de etapas incompleta");
  }
  for (const stageId of requestedStageIds) {
    if (!knownStageIds.has(stageId)) throw new Error("Etapa invalida");
  }

  await Promise.all(
    normalized.stage_ids.map((stageId, orderIndex) =>
      db
        .from("agent_stages")
        .update({ order_index: orderIndex, updated_at: new Date().toISOString() })
        .eq("organization_id", orgId)
        .eq("config_id", normalized.config_id)
        .eq("id", stageId),
    ),
  );

  revalidatePath(`/dashboard/agents/${normalized.config_id}`);
}

async function nextStageOrderIndex(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<number> {
  const { data } = await db
    .from("agent_stages")
    .select("order_index")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Number(data?.order_index ?? -1) + 1;
}

async function enableDefaultStopTool(
  db: AgentDb,
  orgId: string,
  configId: string,
  stageId: string,
): Promise<void> {
  const { data: tool } = await db
    .from("agent_tools")
    .select("id")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .eq("name", "stop_agent")
    .maybeSingle();

  if (!tool?.id) return;
  await db
    .from("agent_stage_tools")
    .upsert({
      organization_id: orgId,
      stage_id: stageId,
      tool_id: tool.id,
      is_enabled: true,
    });
}
