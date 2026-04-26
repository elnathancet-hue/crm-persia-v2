"use server";

import { revalidatePath } from "next/cache";
import {
  clampFollowupDelayHours,
  FOLLOWUPS_MAX_PER_AGENT,
  FOLLOWUP_NAME_MAX_CHARS,
  FOLLOWUP_NAME_MIN_CHARS,
  validateFollowupInput,
  type AgentFollowup,
  type CreateFollowupInput,
  type UpdateFollowupInput,
} from "@persia/shared/ai-agent";
import { fromAny, type AgentDb } from "@/lib/ai-agent/db";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

// ============================================================================
// Listing
// ============================================================================

export async function listFollowups(
  orgId: string,
  configId: string,
): Promise<AgentFollowup[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await fromAny(db, "agent_followups")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("order_index", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentFollowup[];
}

// ============================================================================
// Create
// ============================================================================

export async function createFollowup(
  orgId: string,
  input: CreateFollowupInput,
): Promise<AgentFollowup> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const errors = validateFollowupInput(input);
    if (Object.keys(errors).length > 0) {
      throw new Error(
        errors.name || errors.template_id || errors.delay_hours || "Dados invalidos",
      );
    }

    await assertConfigBelongsToOrg(db, orgId, input.config_id);
    await assertFollowupLimit(db, orgId, input.config_id);
    await assertTemplateBelongsToOrg(db, orgId, input.template_id);

    const nextOrder = await getNextOrderIndex(db, orgId, input.config_id);

    const { data, error } = await fromAny(db, "agent_followups")
      .insert({
        organization_id: orgId,
        config_id: input.config_id,
        name: input.name.trim().slice(0, FOLLOWUP_NAME_MAX_CHARS),
        template_id: input.template_id,
        delay_hours: clampFollowupDelayHours(input.delay_hours),
        is_enabled: input.is_enabled ?? true,
        order_index: nextOrder,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Erro ao criar follow-up");
    }

    const created = data as AgentFollowup;

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_followup_create",
      entityType: "agent_followup",
      entityId: created.id,
      metadata: {
        config_id: input.config_id,
        name: created.name,
        delay_hours: created.delay_hours,
      },
    });

    for (const path of agentPaths(input.config_id)) revalidatePath(path);
    return created;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_followup_create",
      entityType: "agent_followup",
      metadata: { config_id: input.config_id, name: input.name },
      error,
    });
    throw error;
  }
}

// ============================================================================
// Update
// ============================================================================

export async function updateFollowup(
  orgId: string,
  followupId: string,
  input: UpdateFollowupInput,
): Promise<AgentFollowup> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertFollowupBelongsToOrg(db, orgId, followupId);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (
        name.length < FOLLOWUP_NAME_MIN_CHARS ||
        name.length > FOLLOWUP_NAME_MAX_CHARS
      ) {
        throw new Error(
          `Nome deve ter entre ${FOLLOWUP_NAME_MIN_CHARS} e ${FOLLOWUP_NAME_MAX_CHARS} caracteres`,
        );
      }
      updates.name = name;
    }

    if (input.template_id !== undefined) {
      await assertTemplateBelongsToOrg(db, orgId, input.template_id);
      updates.template_id = input.template_id;
    }

    if (input.delay_hours !== undefined) {
      updates.delay_hours = clampFollowupDelayHours(input.delay_hours);
    }
    if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
    if (input.order_index !== undefined) updates.order_index = input.order_index;

    const { data, error } = await fromAny(db, "agent_followups")
      .update(updates)
      .eq("organization_id", orgId)
      .eq("id", followupId)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Erro ao atualizar follow-up");
    }

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_followup_update",
      entityType: "agent_followup",
      entityId: followupId,
      metadata: {
        config_id: existing.config_id,
        is_enabled_changed: input.is_enabled !== undefined,
        delay_changed: input.delay_hours !== undefined,
      },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
    return data as AgentFollowup;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_followup_update",
      entityType: "agent_followup",
      entityId: followupId,
      error,
    });
    throw error;
  }
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteFollowup(
  orgId: string,
  followupId: string,
): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertFollowupBelongsToOrg(db, orgId, followupId);

    const { error } = await fromAny(db, "agent_followups")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", followupId);
    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_followup_delete",
      entityType: "agent_followup",
      entityId: followupId,
      metadata: { config_id: existing.config_id, name: existing.name },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_followup_delete",
      entityType: "agent_followup",
      entityId: followupId,
      error,
    });
    throw error;
  }
}

// ============================================================================
// Toggle (sugar wrapper sobre updateFollowup)
// ============================================================================

export async function toggleFollowup(
  orgId: string,
  followupId: string,
  isEnabled: boolean,
): Promise<AgentFollowup> {
  return updateFollowup(orgId, followupId, { is_enabled: isEnabled });
}

// ============================================================================
// Helpers
// ============================================================================

async function assertFollowupBelongsToOrg(
  db: AgentDb,
  orgId: string,
  followupId: string,
): Promise<AgentFollowup> {
  const { data, error } = await fromAny(db, "agent_followups")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", followupId)
    .maybeSingle();
  if (error || !data) throw new Error("Follow-up nao encontrado");
  return data as AgentFollowup;
}

async function assertFollowupLimit(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<void> {
  const { count, error } = await fromAny(db, "agent_followups")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("config_id", configId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= FOLLOWUPS_MAX_PER_AGENT) {
    throw new Error(
      `Limite de ${FOLLOWUPS_MAX_PER_AGENT} follow-ups por agente atingido. Remova um antes de criar outro.`,
    );
  }
}

async function assertTemplateBelongsToOrg(
  db: AgentDb,
  orgId: string,
  templateId: string,
): Promise<void> {
  const { data, error } = await fromAny(db, "agent_notification_templates")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("id", templateId)
    .maybeSingle();
  if (error || !data) {
    throw new Error("Template nao encontrado nesta organizacao");
  }
  if ((data as { status?: string }).status !== "active") {
    throw new Error("Template selecionado nao esta ativo");
  }
}

async function getNextOrderIndex(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<number> {
  const { data } = await fromAny(db, "agent_followups")
    .select("order_index")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("order_index", { ascending: false })
    .limit(1);
  const last = (data?.[0] as { order_index?: number } | undefined)?.order_index ?? -1;
  return last + 1;
}
