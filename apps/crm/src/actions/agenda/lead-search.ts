"use server";

import { requireRole } from "@/lib/auth";
import { listLeads } from "@persia/shared/crm";
import type { LeadOption } from "@persia/agenda-ui";

/**
 * Busca leads pra autocomplete em forms da Agenda. Retorna shape minimo
 * (LeadOption) — agenda-ui nao depende dos tipos do CRM diretamente.
 *
 * Limit cap em 20 pra evitar paginacao desnecessaria.
 */
export async function searchLeadsForAgenda(
  query: string,
  limit = 8,
): Promise<LeadOption[]> {
  const { supabase, orgId } = await requireRole("agent");

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const result = await listLeads(
    { db: supabase, orgId },
    { search: trimmed, limit: Math.min(limit, 20), page: 1 },
  );

  return result.leads.map((l) => ({
    id: l.id,
    name: l.name ?? l.phone ?? "Lead sem nome",
    phone: l.phone ?? null,
    email: l.email ?? null,
  }));
}
