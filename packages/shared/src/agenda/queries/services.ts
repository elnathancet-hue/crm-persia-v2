// agenda_services — queries read-only.

import type { AgendaService } from "../types";
import type { AgendaQueryContext } from "./context";

const SELECT = `
  id, organization_id, name, description,
  duration_minutes, price_cents, color, is_active,
  created_at, updated_at
`;

export interface ListServicesFilters {
  /** Default: undefined (todos). */
  is_active?: boolean;
  search?: string;
}

export async function listAgendaServices(
  ctx: AgendaQueryContext,
  filters: ListServicesFilters = {},
): Promise<AgendaService[]> {
  const { db, orgId } = ctx;
  let query = db
    .from("agenda_services")
    .select(SELECT)
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  if (typeof filters.is_active === "boolean") {
    query = query.eq("is_active", filters.is_active);
  }
  if (filters.search) {
    // Sanitiza wildcards de ILIKE — evita user injetar `%`/`_`.
    const safe = filters.search.replace(/[%_,()\\]/g, "");
    if (safe.length > 0) query = query.ilike("name", `%${safe}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listAgendaServices: ${error.message}`);
  return (data ?? []) as AgendaService[];
}

export async function getAgendaService(
  ctx: AgendaQueryContext,
  id: string,
): Promise<AgendaService | null> {
  const { db, orgId } = ctx;
  const { data, error } = await db
    .from("agenda_services")
    .select(SELECT)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getAgendaService: ${error.message}`);
  return (data as AgendaService | null) ?? null;
}
