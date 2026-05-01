// availability_rules — mutations.
//
// Garante que (org_id, user_id) so tem 1 default. Se user marca outra
// regra como is_default=true, a anterior eh desmarcada na MESMA action.

import type { AvailabilityDay, AvailabilityRule } from "../types";
import type { AgendaMutationContext } from "../queries/context";

const RETURN = `
  id, organization_id, user_id, name, timezone,
  default_duration_minutes, days, is_default,
  created_at, updated_at
`;

export interface CreateAvailabilityRuleInput {
  user_id: string;
  name?: string;
  timezone?: string;
  default_duration_minutes?: number;
  days?: AvailabilityDay[];
  is_default?: boolean;
}

async function clearOtherDefaults(
  ctx: AgendaMutationContext,
  user_id: string,
  exclude_id?: string,
): Promise<void> {
  const { db, orgId } = ctx;
  let query = db
    .from("availability_rules")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("user_id", user_id)
    .eq("is_default", true);
  if (exclude_id) query = query.neq("id", exclude_id);
  const { error } = await query;
  if (error) throw new Error(`clearOtherDefaults: ${error.message}`);
}

export async function createAvailabilityRule(
  ctx: AgendaMutationContext,
  input: CreateAvailabilityRuleInput,
): Promise<AvailabilityRule> {
  const { db, orgId } = ctx;
  const is_default = input.is_default ?? false;
  if (is_default) await clearOtherDefaults(ctx, input.user_id);

  const { data, error } = await db
    .from("availability_rules")
    .insert({
      organization_id: orgId,
      user_id: input.user_id,
      name: input.name ?? "Padrão",
      timezone: input.timezone ?? "America/Sao_Paulo",
      default_duration_minutes: input.default_duration_minutes ?? 60,
      days: input.days ?? [],
      is_default,
    })
    .select(RETURN)
    .single();
  if (error) throw new Error(`createAvailabilityRule: ${error.message}`);
  return data as AvailabilityRule;
}

export interface UpdateAvailabilityRuleInput {
  name?: string;
  timezone?: string;
  default_duration_minutes?: number;
  days?: AvailabilityDay[];
  is_default?: boolean;
}

export async function updateAvailabilityRule(
  ctx: AgendaMutationContext,
  id: string,
  input: UpdateAvailabilityRuleInput,
): Promise<AvailabilityRule> {
  const { db, orgId } = ctx;

  if (input.is_default === true) {
    // Precisa do user_id pra limpar os outros — busca o atual.
    const { data: current, error: curErr } = await db
      .from("availability_rules")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (curErr) throw new Error(`updateAvailabilityRule.lookup: ${curErr.message}`);
    if (!current) throw new Error("updateAvailabilityRule: nao encontrado");
    await clearOtherDefaults(ctx, (current as { user_id: string }).user_id, id);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.default_duration_minutes !== undefined)
    patch.default_duration_minutes = input.default_duration_minutes;
  if (input.days !== undefined) patch.days = input.days;
  if (input.is_default !== undefined) patch.is_default = input.is_default;

  const { data, error } = await db
    .from("availability_rules")
    .update(patch)
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN)
    .single();
  if (error) throw new Error(`updateAvailabilityRule: ${error.message}`);
  return data as AvailabilityRule;
}

export async function deleteAvailabilityRule(
  ctx: AgendaMutationContext,
  id: string,
): Promise<void> {
  const { db, orgId } = ctx;
  const { error } = await db
    .from("availability_rules")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`deleteAvailabilityRule: ${error.message}`);
}
