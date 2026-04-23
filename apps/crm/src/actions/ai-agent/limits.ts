"use server";

import { type AgentCostLimit, type SetCostLimitInput } from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { assertConfigBelongsToOrg, agentPaths, requireAgentRole } from "./utils";

export async function listCostLimits(): Promise<AgentCostLimit[]> {
  const { db, orgId } = await requireAgentRole("admin");
  const { data, error } = await db
    .from("agent_cost_limits")
    .select("*")
    .eq("organization_id", orgId)
    .order("scope", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentCostLimit[];
}

export async function setCostLimit(input: SetCostLimitInput): Promise<AgentCostLimit> {
  const { db, orgId } = await requireAgentRole("admin");
  const normalized = await normalizeCostLimitInput(db, orgId, input);

  const { data: existingRows, error: existingError } = await db
    .from("agent_cost_limits")
    .select("*")
    .eq("organization_id", orgId)
    .eq("scope", normalized.scope)
    .order("created_at", { ascending: true });

  if (existingError) throw new Error(existingError.message);

  const existing = ((existingRows ?? []) as AgentCostLimit[]).find(
    (row) => (row.subject_id ?? null) === normalized.subject_id,
  );

  if (existing) {
    const { data, error } = await db
      .from("agent_cost_limits")
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
    revalidateLimitPaths(normalized.subject_id);
    return data as AgentCostLimit;
  }

  const { data, error } = await db
    .from("agent_cost_limits")
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
  revalidateLimitPaths(normalized.subject_id);
  return data as AgentCostLimit;
}

export async function deleteCostLimit(id: string): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  const { data, error } = await db
    .from("agent_cost_limits")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Limite nao encontrado");

  const { error: deleteError } = await db
    .from("agent_cost_limits")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id);

  if (deleteError) throw new Error(deleteError.message);
  revalidateLimitPaths((data as AgentCostLimit).subject_id ?? null);
}

async function normalizeCostLimitInput(
  db: Awaited<ReturnType<typeof requireAgentRole>>["db"],
  orgId: string,
  input: SetCostLimitInput,
): Promise<{
  scope: SetCostLimitInput["scope"];
  subject_id: string | null;
  max_tokens: number | null;
  max_usd_cents: number | null;
}> {
  if (!["run", "agent_daily", "org_daily", "org_monthly"].includes(input.scope)) {
    throw new Error("Escopo de limite invalido");
  }

  const maxTokens = normalizeNullableInt(input.max_tokens);
  const maxUsdCents = normalizeNullableInt(input.max_usd_cents);
  const subjectId: string | null = input.subject_id ?? null;

  if (input.scope === "agent_daily") {
    if (!subjectId) throw new Error("subject_id e obrigatorio para agent_daily");
    await assertConfigBelongsToOrg(db, orgId, subjectId);
  } else if (subjectId) {
    throw new Error("subject_id so pode ser usado em agent_daily");
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
    throw new Error("Limite invalido");
  }
  return Math.floor(normalized);
}

function revalidateLimitPaths(subjectId: string | null): void {
  for (const path of agentPaths(subjectId ?? undefined)) {
    revalidatePath(path);
  }
}
