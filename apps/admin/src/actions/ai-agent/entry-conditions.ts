"use server";

import {
  isValidConditionValue,
  type AgentEntryCondition,
  type CreateEntryConditionInput,
  type EntryConditionType,
  type EntryConditionValue,
  type UpdateEntryConditionInput,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { fromAny } from "@/lib/ai-agent/db";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

// PR-AGENT-INTEGRATION-3: paridade com CRM (apps/crm/.../entry-conditions.ts)
// + audit log do admin context.

function assertValidValue(
  type: EntryConditionType,
  value: EntryConditionValue,
): void {
  if (!isValidConditionValue(type, value)) {
    throw new Error(`Valor invalido pra condition_type=${type}`);
  }
}

export async function listEntryConditions(
  orgId: string,
  configId: string,
): Promise<AgentEntryCondition[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);
  const { data, error } = await fromAny(db, "agent_entry_conditions")
    .select("*")
    .eq("organization_id", orgId)
    .eq("agent_config_id", configId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentEntryCondition[];
}

export async function createEntryCondition(
  orgId: string,
  input: CreateEntryConditionInput,
): Promise<AgentEntryCondition> {
  const { db, userId } = await requireAdminAgentOrg(orgId);
  try {
    await assertConfigBelongsToOrg(db, orgId, input.agent_config_id);
    assertValidValue(input.condition_type, input.condition_value);

    const { data, error } = await fromAny(db, "agent_entry_conditions")
      .insert({
        organization_id: orgId,
        agent_config_id: input.agent_config_id,
        condition_type: input.condition_type,
        condition_value: input.condition_value,
        priority: input.priority ?? 0,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "Erro ao criar");

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_entry_condition_create",
      entityType: "agent_entry_condition",
      entityId: (data as AgentEntryCondition).id,
      metadata: { config_id: input.agent_config_id, type: input.condition_type },
    });

    for (const path of agentPaths(input.agent_config_id)) revalidatePath(path);
    return data as AgentEntryCondition;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_entry_condition_create",
      entityType: "agent_entry_condition",
      metadata: { config_id: input.agent_config_id },
      error,
    });
    throw error;
  }
}

export async function updateEntryCondition(
  orgId: string,
  conditionId: string,
  input: UpdateEntryConditionInput,
): Promise<AgentEntryCondition> {
  const { db, userId } = await requireAdminAgentOrg(orgId);
  try {
    const { data: existing, error: existingErr } = await fromAny(
      db,
      "agent_entry_conditions",
    )
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", conditionId)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    if (!existing) throw new Error("Regra nao encontrada");

    const row = existing as AgentEntryCondition;
    const nextType = input.condition_type ?? row.condition_type;
    const nextValue = input.condition_value ?? row.condition_value;
    assertValidValue(nextType, nextValue);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.condition_type !== undefined) updates.condition_type = input.condition_type;
    if (input.condition_value !== undefined) updates.condition_value = input.condition_value;
    if (input.priority !== undefined) updates.priority = input.priority;

    const { data, error } = await fromAny(db, "agent_entry_conditions")
      .update(updates)
      .eq("organization_id", orgId)
      .eq("id", conditionId)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "Erro ao atualizar");

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_entry_condition_update",
      entityType: "agent_entry_condition",
      entityId: conditionId,
    });

    for (const path of agentPaths(row.agent_config_id)) revalidatePath(path);
    return data as AgentEntryCondition;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_entry_condition_update",
      entityType: "agent_entry_condition",
      entityId: conditionId,
      error,
    });
    throw error;
  }
}

export async function deleteEntryCondition(
  orgId: string,
  conditionId: string,
): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);
  try {
    const { data: existing } = await fromAny(db, "agent_entry_conditions")
      .select("agent_config_id")
      .eq("organization_id", orgId)
      .eq("id", conditionId)
      .maybeSingle();

    const { error } = await fromAny(db, "agent_entry_conditions")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", conditionId);
    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_entry_condition_delete",
      entityType: "agent_entry_condition",
      entityId: conditionId,
    });

    const configId = (existing as { agent_config_id?: string } | null)?.agent_config_id;
    if (configId) for (const path of agentPaths(configId)) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_entry_condition_delete",
      entityType: "agent_entry_condition",
      entityId: conditionId,
      error,
    });
    throw error;
  }
}
