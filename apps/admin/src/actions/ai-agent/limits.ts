"use server";

import {
  type AgentCostLimit,
  type CostLimitScope,
  type SetCostLimitInput,
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

export async function listCostLimits(orgId: string): Promise<AgentCostLimit[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  const { data, error } = await fromAny(db, "agent_cost_limits")
    .select("*")
    .eq("organization_id", orgId)
    .order("scope", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentCostLimit[];
}

export async function setCostLimit(
  orgId: string,
  input: SetCostLimitInput,
): Promise<AgentCostLimit> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const normalized = await normalizeCostLimitInput(db, orgId, input);

    const { data: existingRows, error: existingError } = await fromAny(db, "agent_cost_limits")
      .select("*")
      .eq("organization_id", orgId)
      .eq("scope", normalized.scope)
      .order("created_at", { ascending: true });

    if (existingError) throw new Error(existingError.message);

    const existing = ((existingRows ?? []) as AgentCostLimit[]).find(
      (row) => (row.subject_id ?? null) === normalized.subject_id,
    );

    if (existing) {
      const { data, error } = await fromAny(db, "agent_cost_limits")
        .update({
          max_tokens: normalized.max_tokens,
          max_usd_cents: normalized.max_usd_cents,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", orgId)
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error || !data) throw new Error(error?.message || "Erro ao atualizar limite");

      await auditAdminAgentAction({
        userId,
        orgId,
        action: "admin_ai_agent_limit_set",
        entityType: "agent_cost_limit",
        entityId: existing.id,
        metadata: normalized,
      });

      revalidateLimitPaths(normalized.subject_id);
      return data as AgentCostLimit;
    }

    const { data, error } = await fromAny(db, "agent_cost_limits")
      .insert({
        organization_id: orgId,
        scope: normalized.scope,
        subject_id: normalized.subject_id,
        max_tokens: normalized.max_tokens,
        max_usd_cents: normalized.max_usd_cents,
      })
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro ao criar limite");

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_limit_set",
      entityType: "agent_cost_limit",
      entityId: (data as AgentCostLimit).id,
      metadata: normalized,
    });

    revalidateLimitPaths(normalized.subject_id);
    return data as AgentCostLimit;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_limit_set",
      entityType: "agent_cost_limit",
      metadata: input as unknown as Record<string, unknown>,
      error,
    });
    throw error;
  }
}

export async function deleteCostLimit(orgId: string, id: string): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const { data, error } = await fromAny(db, "agent_cost_limits")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error("Limite não encontrado");

    const { error: deleteError } = await fromAny(db, "agent_cost_limits")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", id);

    if (deleteError) throw new Error(deleteError.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_limit_delete",
      entityType: "agent_cost_limit",
      entityId: id,
      metadata: { scope: (data as AgentCostLimit).scope },
    });

    revalidateLimitPaths((data as AgentCostLimit).subject_id ?? null);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_limit_delete",
      entityType: "agent_cost_limit",
      entityId: id,
      error,
    });
    throw error;
  }
}

async function normalizeCostLimitInput(
  db: Awaited<ReturnType<typeof requireAdminAgentOrg>>["db"],
  orgId: string,
  input: SetCostLimitInput,
): Promise<{
  scope: CostLimitScope;
  subject_id: string | null;
  max_tokens: number | null;
  max_usd_cents: number | null;
}> {
  if (!["run", "agent_daily", "org_daily", "org_monthly"].includes(input.scope)) {
    throw new Error("Escopo de limite inválido");
  }

  const maxTokens = normalizeNullableInt(input.max_tokens);
  const maxUsdCents = normalizeNullableInt(input.max_usd_cents);
  const subjectId: string | null = input.subject_id ?? null;

  if (input.scope === "agent_daily") {
    if (!subjectId) throw new Error("subject_id é obrigatório para agent_daily");
    await assertConfigBelongsToOrg(db, orgId, subjectId);
  } else if (subjectId) {
    throw new Error("subject_id só pode ser usado em agent_daily");
  }

  return {
    scope: input.scope,
    subject_id: subjectId,
    max_tokens: maxTokens,
    max_usd_cents: maxUsdCents,
  };
}

function normalizeNullableInt(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("Limite inválido");
  }
  return Math.floor(normalized);
}

function revalidateLimitPaths(subjectId: string | null): void {
  for (const path of agentPaths(subjectId ?? undefined)) {
    revalidatePath(path);
  }
}
