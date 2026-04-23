"use server";

import type {
  AgentStageTool,
  AgentTool,
  CreateToolFromPresetInput,
  CreateToolInput,
  SetStageToolInput,
  UpdateToolInput,
} from "@persia/shared/ai-agent";
import { getPreset } from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { materializePresetTool } from "@/lib/ai-agent/tools/registry";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  assertStageBelongsToOrg,
  assertToolBelongsToOrg,
  requireAgentRole,
  upsertStageToolRow,
} from "./utils";

const ENABLED_PRESET_PRS = new Set(["PR1", "PR3"]);

export async function listToolsForAgent(configId: string): Promise<AgentTool[]> {
  const { db, orgId } = await requireAgentRole("agent");
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await db
    .from("agent_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentTool[];
}

export async function createToolFromPreset(
  input: CreateToolFromPresetInput,
): Promise<AgentTool> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, input.config_id);

  const preset = getPreset(input.handler);
  if (!preset) throw new Error("Preset de ferramenta nao encontrado");
  if (!ENABLED_PRESET_PRS.has(preset.shipped_in_pr)) {
    throw new Error(`Ferramenta disponivel apenas em ${preset.shipped_in_pr}`);
  }

  const { data: existing, error: existingError } = await db
    .from("agent_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", input.config_id)
    .eq("native_handler", input.handler)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) return existing as AgentTool;

  const { data, error } = await db
    .from("agent_tools")
    .insert(
      materializePresetTool({
        configId: input.config_id,
        organizationId: orgId,
        preset,
      }),
    )
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar ferramenta");
  for (const path of agentPaths(input.config_id)) revalidatePath(path);
  return data as AgentTool;
}

export async function createCustomTool(input: CreateToolInput): Promise<AgentTool> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, input.config_id);

  if (input.execution_mode === "n8n_webhook") {
    throw new Error("Custom webhook tools ficam disponiveis apenas na PR5");
  }
  if (input.execution_mode === "native" && !input.native_handler) {
    throw new Error("native_handler e obrigatorio para tools nativos");
  }

  const { data, error } = await db
    .from("agent_tools")
    .insert({
      organization_id: orgId,
      config_id: input.config_id,
      name: input.name.trim(),
      description: input.description.trim(),
      input_schema: input.input_schema,
      execution_mode: input.execution_mode,
      native_handler: input.native_handler ?? null,
      webhook_url: null,
      webhook_secret: null,
      is_enabled: input.is_enabled ?? true,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar ferramenta");
  for (const path of agentPaths(input.config_id)) revalidatePath(path);
  return data as AgentTool;
}

export async function updateTool(toolId: string, input: UpdateToolInput): Promise<AgentTool> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertToolBelongsToOrg(db, orgId, toolId);

  if (input.execution_mode === "n8n_webhook") {
    throw new Error("Custom webhook tools ficam disponiveis apenas na PR5");
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.input_schema !== undefined) updates.input_schema = input.input_schema;
  if (input.execution_mode !== undefined) updates.execution_mode = input.execution_mode;
  if (input.native_handler !== undefined) updates.native_handler = input.native_handler;
  if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;

  const { data, error } = await db
    .from("agent_tools")
    .update(updates)
    .eq("organization_id", orgId)
    .eq("id", toolId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao atualizar ferramenta");
  for (const path of agentPaths(existing.config_id)) revalidatePath(path);
  return data as AgentTool;
}

export async function deleteTool(toolId: string): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertToolBelongsToOrg(db, orgId, toolId);

  const { error } = await db
    .from("agent_tools")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", toolId);

  if (error) throw new Error(error.message);
  for (const path of agentPaths(existing.config_id)) revalidatePath(path);
}

export async function setStageTool(input: SetStageToolInput): Promise<AgentStageTool> {
  const { db, orgId } = await requireAgentRole("admin");
  const stage = await assertStageBelongsToOrg(db, orgId, input.stage_id);
  const tool = await assertToolBelongsToOrg(db, orgId, input.tool_id);

  if (stage.config_id !== tool.config_id) {
    throw new Error("Etapa e ferramenta precisam pertencer ao mesmo agente");
  }

  const row = await upsertStageToolRow(db, orgId, input.stage_id, input.tool_id, input.is_enabled);
  for (const path of agentPaths(stage.config_id)) revalidatePath(path);
  return row;
}

export async function listStageTools(stageId: string): Promise<AgentStageTool[]> {
  const { db, orgId } = await requireAgentRole("agent");
  await assertStageBelongsToOrg(db, orgId, stageId);

  const { data, error } = await db
    .from("agent_stage_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("stage_id", stageId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentStageTool[];
}
