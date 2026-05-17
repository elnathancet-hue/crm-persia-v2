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
import {
  agentPaths,
  assertConfigBelongsToOrg,
  requireAgentRole,
} from "./utils";

// PR-AGENT-INTEGRATION-3 (mai/2026): CRUD pra regras de roteamento de
// agentes secundarios (migration 045). Cada regra: { config_id, type,
// value, priority }. Server valida tipo+value via isValidConditionValue.

function assertValidValue(
  type: EntryConditionType,
  value: EntryConditionValue,
): void {
  if (!isValidConditionValue(type, value)) {
    throw new Error(`Valor invalido pra condition_type=${type}`);
  }
}

export async function listEntryConditions(
  configId: string,
): Promise<AgentEntryCondition[]> {
  const { db, orgId } = await requireAgentRole("agent");
  await assertConfigBelongsToOrg(db, orgId, configId);
  const { data, error } = await db
    .from("agent_entry_conditions")
    .select("*")
    .eq("organization_id", orgId)
    .eq("agent_config_id", configId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentEntryCondition[];
}

export async function createEntryCondition(
  input: CreateEntryConditionInput,
): Promise<AgentEntryCondition> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, input.agent_config_id);
  assertValidValue(input.condition_type, input.condition_value);

  const { data, error } = await db
    .from("agent_entry_conditions")
    .insert({
      organization_id: orgId,
      agent_config_id: input.agent_config_id,
      condition_type: input.condition_type,
      condition_value: input.condition_value,
      priority: input.priority ?? 0,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar regra");
  for (const path of agentPaths(input.agent_config_id)) revalidatePath(path);
  return data as AgentEntryCondition;
}

export async function updateEntryCondition(
  conditionId: string,
  input: UpdateEntryConditionInput,
): Promise<AgentEntryCondition> {
  const { db, orgId } = await requireAgentRole("admin");

  const { data: existing, error: existingErr } = await db
    .from("agent_entry_conditions")
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

  const { data, error } = await db
    .from("agent_entry_conditions")
    .update(updates)
    .eq("organization_id", orgId)
    .eq("id", conditionId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao atualizar regra");
  for (const path of agentPaths(row.agent_config_id)) revalidatePath(path);
  return data as AgentEntryCondition;
}

export async function deleteEntryCondition(conditionId: string): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");

  const { data: existing } = await db
    .from("agent_entry_conditions")
    .select("agent_config_id")
    .eq("organization_id", orgId)
    .eq("id", conditionId)
    .maybeSingle();

  const { error } = await db
    .from("agent_entry_conditions")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", conditionId);

  if (error) throw new Error(error.message);
  const configId = (existing as { agent_config_id?: string } | null)?.agent_config_id;
  if (configId) for (const path of agentPaths(configId)) revalidatePath(path);
}
