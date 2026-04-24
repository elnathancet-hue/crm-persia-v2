"use server";

import {
  DEFAULT_GUARDRAILS,
  type AgentConfig,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { fromAny } from "@/lib/ai-agent/db";
import {
  agentPaths,
  assertAgentStatus,
  assertConfigBelongsToOrg,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  getDefaultStopAgentToolSeed,
  mergeGuardrails,
  normalizeAgentInput,
  normalizeAgentPatch,
  requireAdminAgentOrg,
} from "./utils";

export async function listAgents(orgId: string): Promise<AgentConfig[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  const { data, error } = await fromAny(db, "agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentConfig[];
}

export async function getAgent(orgId: string, configId: string): Promise<AgentConfig | null> {
  const { db } = await requireAdminAgentOrg(orgId);
  const { data, error } = await fromAny(db, "agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentConfig | null) ?? null;
}

export async function createAgent(
  orgId: string,
  input: CreateAgentInput,
): Promise<AgentConfig> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const normalized = normalizeAgentInput(input);
    const guardrails = mergeGuardrails(DEFAULT_GUARDRAILS, normalized.guardrails);

    const { data, error } = await fromAny(db, "agent_configs")
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
        handoff_notification_enabled: normalized.handoff_notification_enabled ?? false,
        handoff_notification_target_type: normalized.handoff_notification_target_type ?? null,
        handoff_notification_target_address: normalized.handoff_notification_target_address ?? null,
        handoff_notification_template: normalized.handoff_notification_template ?? null,
        status: "draft",
      })
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro ao criar agente");
    const config = data as AgentConfig;

    const { error: toolError } = await fromAny(db, "agent_tools")
      .insert(getDefaultStopAgentToolSeed({ configId: config.id, organizationId: orgId }));
    if (toolError) throw new Error(toolError.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_create",
      entityType: "agent_config",
      entityId: config.id,
      metadata: { name: config.name },
    });

    for (const path of agentPaths()) revalidatePath(path);
    return config;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_create",
      entityType: "agent_config",
      metadata: { name: input.name },
      error,
    });
    throw error;
  }
}

export async function updateAgent(
  orgId: string,
  configId: string,
  input: UpdateAgentInput,
): Promise<AgentConfig> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertConfigBelongsToOrg(db, orgId, configId);
    const patch = normalizeAgentPatch(input, existing);
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
    if (patch.handoff_notification_enabled !== undefined) {
      updates.handoff_notification_enabled = patch.handoff_notification_enabled;
    }
    if (patch.handoff_notification_target_type !== undefined) {
      updates.handoff_notification_target_type = patch.handoff_notification_target_type;
    }
    if (patch.handoff_notification_target_address !== undefined) {
      updates.handoff_notification_target_address = patch.handoff_notification_target_address;
    }
    if (patch.handoff_notification_template !== undefined) {
      updates.handoff_notification_template = patch.handoff_notification_template;
    }
    if (patch.status !== undefined) updates.status = patch.status;

    const { data, error } = await fromAny(db, "agent_configs")
      .update(updates)
      .eq("organization_id", orgId)
      .eq("id", configId)
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro ao atualizar agente");

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_update",
      entityType: "agent_config",
      entityId: configId,
      metadata: { fields: Object.keys(updates) },
    });

    for (const path of agentPaths(configId)) revalidatePath(path);
    return data as AgentConfig;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_update",
      entityType: "agent_config",
      entityId: configId,
      metadata: { fields: Object.keys(input) },
      error,
    });
    throw error;
  }
}

export async function deleteAgent(orgId: string, configId: string): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    await assertConfigBelongsToOrg(db, orgId, configId);

    const { error } = await fromAny(db, "agent_configs")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", configId);

    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_delete",
      entityType: "agent_config",
      entityId: configId,
    });

    for (const path of agentPaths()) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_delete",
      entityType: "agent_config",
      entityId: configId,
      error,
    });
    throw error;
  }
}
