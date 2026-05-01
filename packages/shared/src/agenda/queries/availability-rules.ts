// availability_rules — queries read-only.

import type { AvailabilityRule } from "../types";
import type { AgendaQueryContext } from "./context";

const SELECT = `
  id, organization_id, user_id, name, timezone,
  default_duration_minutes, days, is_default,
  created_at, updated_at
`;

export async function listAvailabilityRules(
  ctx: AgendaQueryContext,
  filters: { user_id?: string } = {},
): Promise<AvailabilityRule[]> {
  const { db, orgId } = ctx;
  let query = db
    .from("availability_rules")
    .select(SELECT)
    .eq("organization_id", orgId)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (filters.user_id) query = query.eq("user_id", filters.user_id);

  const { data, error } = await query;
  if (error) throw new Error(`listAvailabilityRules: ${error.message}`);
  return (data ?? []) as AvailabilityRule[];
}

export async function getAvailabilityRule(
  ctx: AgendaQueryContext,
  id: string,
): Promise<AvailabilityRule | null> {
  const { db, orgId } = ctx;
  const { data, error } = await db
    .from("availability_rules")
    .select(SELECT)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getAvailabilityRule: ${error.message}`);
  return (data as AvailabilityRule | null) ?? null;
}

/**
 * Retorna a regra default do user (is_default = true). Usado pra:
 *   1) calculo de slots em booking pages
 *   2) check de availability ao criar appointment
 * Retorna null se o user nao tem regra cadastrada.
 */
export async function getDefaultAvailabilityRule(
  ctx: AgendaQueryContext,
  user_id: string,
): Promise<AvailabilityRule | null> {
  const { db, orgId } = ctx;
  const { data, error } = await db
    .from("availability_rules")
    .select(SELECT)
    .eq("organization_id", orgId)
    .eq("user_id", user_id)
    .eq("is_default", true)
    .maybeSingle();

  if (error) throw new Error(`getDefaultAvailabilityRule: ${error.message}`);
  return (data as AvailabilityRule | null) ?? null;
}
