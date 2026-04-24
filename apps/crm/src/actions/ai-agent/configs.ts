"use server";

import {
  DEFAULT_GUARDRAILS,
  type AgentConfig,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { getDefaultStopAgentTool } from "@/lib/ai-agent/tools/registry";
import {
  assertAgentStatus,
  assertConfigBelongsToOrg,
  agentPaths,
  mergeGuardrails,
  normalizeAgentInput,
  normalizeAgentPatch,
  requireAgentRole,
} from "./utils";

export async function listAgents(): Promise<AgentConfig[]> {
  const { db, orgId } = await requireAgentRole("agent");
  const { data, error } = await db
    .from("agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentConfig[];
}

export async function getAgent(configId: string): Promise<AgentConfig | null> {
  const { db, orgId } = await requireAgentRole("agent");
  const { data, error } = await db
    .from("agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentConfig | null) ?? null;
}

export async function createAgent(input: CreateAgentInput): Promise<AgentConfig> {
  const { db, orgId } = await requireAgentRole("admin");
  const normalized = normalizeAgentInput(input);
  const guardrails = mergeGuardrails(DEFAULT_GUARDRAILS, normalized.guardrails);

  const { data, error } = await db
    .from("agent_configs")
    .insert({
      organization_id: orgId,
      name: normalized.name,
      description: normalized.description ?? null,
      scope_type: normalized.scope_type,
      scope_id: normalized.scope_id ?? null,
      model: normalized.model,
      system_prompt: normalized.system_prompt,
      guardrails,
      debounce_window_ms: normalized.debounce_window_ms,
      context_summary_turn_threshold: normalized.context_summary_turn_threshold,
      context_summary_token_threshold: normalized.context_summary_token_threshold,
      context_summary_recent_messages: normalized.context_summary_recent_messages,
      status: "draft",
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar agente");
  const config = data as AgentConfig;

  const defaultTool = getDefaultStopAgentTool({
    configId: config.id,
    organizationId: orgId,
  });
  const { error: toolError } = await db.from("agent_tools").insert(defaultTool);
  if (toolError) throw new Error(toolError.message);

  for (const path of agentPaths()) revalidatePath(path);
  return config;
}

export async function updateAgent(
  configId: string,
  input: UpdateAgentInput,
): Promise<AgentConfig> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertConfigBelongsToOrg(db, orgId, configId);
  const patch = normalizeAgentPatch(input);
  assertAgentStatus(patch.status);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.description !== undefined) updates.description = patch.description || null;
  if (patch.scope_type !== undefined) updates.scope_type = patch.scope_type;
  if (patch.scope_id !== undefined) updates.scope_id = patch.scope_id ?? null;
  if (patch.model !== undefined) updates.model = patch.model;
  if (patch.system_prompt !== undefined) updates.system_prompt = patch.system_prompt;
  if (patch.guardrails !== undefined) {
    updates.guardrails = mergeGuardrails(existing.guardrails, patch.guardrails);
  }
  if (patch.debounce_window_ms !== undefined) {
    updates.debounce_window_ms = patch.debounce_window_ms;
  }
  if (patch.context_summary_turn_threshold !== undefined) {
    updates.context_summary_turn_threshold = patch.context_summary_turn_threshold;
  }
  if (patch.context_summary_token_threshold !== undefined) {
    updates.context_summary_token_threshold = patch.context_summary_token_threshold;
  }
  if (patch.context_summary_recent_messages !== undefined) {
    updates.context_summary_recent_messages = patch.context_summary_recent_messages;
  }
  if (patch.status !== undefined) updates.status = patch.status;

  const { data, error } = await db
    .from("agent_configs")
    .update(updates)
    .eq("organization_id", orgId)
    .eq("id", configId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao atualizar agente");
  for (const path of agentPaths(configId)) revalidatePath(path);
  return data as AgentConfig;
}

export async function deleteAgent(configId: string): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { error } = await db
    .from("agent_configs")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", configId);

  if (error) throw new Error(error.message);
  for (const path of agentPaths()) revalidatePath(path);
}

