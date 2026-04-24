"use server";

import type {
  AgentStage,
  CreateStageInput,
  ReorderStagesInput,
  UpdateStageInput,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { fromAny, type AgentDb } from "@/lib/ai-agent/db";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  assertStageBelongsToOrg,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  getDefaultStopAgentToolSeed,
  normalizeStageInput,
  normalizeStagePatch,
  requireAdminAgentOrg,
  validateReorder,
} from "./utils";

export async function listStages(orgId: string, configId: string): Promise<AgentStage[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await fromAny(db, "agent_stages")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("order_index", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentStage[];
}

export async function createStage(
  orgId: string,
  configId: string,
  input: CreateStageInput,
): Promise<AgentStage> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    await assertConfigBelongsToOrg(db, orgId, configId);
    const normalized = normalizeStageInput(input);
    const orderIndex = normalized.order_index ?? await nextStageOrderIndex(db, orgId, configId);

    const { data, error } = await fromAny(db, "agent_stages")
      .insert({
        organization_id: orgId,
        config_id: configId,
        slug: normalized.slug,
        order_index: orderIndex,
        situation: normalized.situation,
        instruction: normalized.instruction,
        transition_hint: normalized.transition_hint ?? null,
        rag_enabled: normalized.rag_enabled ?? false,
        ...(normalized.rag_top_k !== undefined ? { rag_top_k: normalized.rag_top_k } : {}),
      })
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro ao criar etapa");
    const stage = data as AgentStage;
    await enableDefaultStopTool(db, orgId, configId, stage.id);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_stage_create",
      entityType: "agent_stage",
      entityId: stage.id,
      metadata: { config_id: configId, situation: stage.situation },
    });

    for (const path of agentPaths(configId)) revalidatePath(path);
    return stage;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_stage_create",
      entityType: "agent_stage",
      metadata: { config_id: configId, situation: input.situation },
      error,
    });
    throw error;
  }
}

export async function updateStage(
  orgId: string,
  stageId: string,
  input: UpdateStageInput,
): Promise<AgentStage> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertStageBelongsToOrg(db, orgId, stageId);
    await assertConfigBelongsToOrg(db, orgId, existing.config_id);
    const patch = normalizeStagePatch(input);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.situation !== undefined) updates.situation = patch.situation;
    if (patch.instruction !== undefined) updates.instruction = patch.instruction;
    if (patch.transition_hint !== undefined) updates.transition_hint = patch.transition_hint || null;
    if (patch.rag_enabled !== undefined) updates.rag_enabled = patch.rag_enabled;
    if (patch.rag_top_k !== undefined) updates.rag_top_k = patch.rag_top_k;
    if (patch.order_index !== undefined) updates.order_index = patch.order_index;
    if (patch.slug !== undefined) updates.slug = patch.slug;

    const { data, error } = await fromAny(db, "agent_stages")
      .update(updates)
      .eq("organization_id", orgId)
      .eq("id", stageId)
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro ao atualizar etapa");

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_stage_update",
      entityType: "agent_stage",
      entityId: stageId,
      metadata: { config_id: existing.config_id, fields: Object.keys(updates) },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
    return data as AgentStage;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_stage_update",
      entityType: "agent_stage",
      entityId: stageId,
      metadata: { fields: Object.keys(input) },
      error,
    });
    throw error;
  }
}

export async function deleteStage(orgId: string, stageId: string): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertStageBelongsToOrg(db, orgId, stageId);

    const { error } = await fromAny(db, "agent_stages")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", stageId);

    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_stage_delete",
      entityType: "agent_stage",
      entityId: stageId,
      metadata: { config_id: existing.config_id },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_stage_delete",
      entityType: "agent_stage",
      entityId: stageId,
      error,
    });
    throw error;
  }
}

export async function reorderStages(orgId: string, input: ReorderStagesInput): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const normalized = validateReorder(input);
    await assertConfigBelongsToOrg(db, orgId, normalized.config_id);

    const { data: stages, error } = await fromAny(db, "agent_stages")
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
      if (!knownStageIds.has(stageId)) throw new Error("Etapa inválida");
    }

    await Promise.all(
      normalized.stage_ids.map((stageId, orderIndex) =>
        fromAny(db, "agent_stages")
          .update({ order_index: orderIndex, updated_at: new Date().toISOString() })
          .eq("organization_id", orgId)
          .eq("config_id", normalized.config_id)
          .eq("id", stageId),
      ),
    );

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_stage_reorder",
      entityType: "agent_config",
      entityId: normalized.config_id,
      metadata: { stage_ids: normalized.stage_ids },
    });

    for (const path of agentPaths(normalized.config_id)) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_stage_reorder",
      entityType: "agent_config",
      entityId: input.config_id,
      metadata: { stage_ids: input.stage_ids },
      error,
    });
    throw error;
  }
}

async function nextStageOrderIndex(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<number> {
  const { data } = await fromAny(db, "agent_stages")
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
  const preset = getDefaultStopAgentToolSeed({ configId, organizationId: orgId });
  const { data: tool } = await fromAny(db, "agent_tools")
    .select("id")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .eq("name", preset.name)
    .maybeSingle();

  if (!tool?.id) return;
  await fromAny(db, "agent_stage_tools").upsert({
    organization_id: orgId,
    stage_id: stageId,
    tool_id: tool.id,
    is_enabled: true,
  });
}
