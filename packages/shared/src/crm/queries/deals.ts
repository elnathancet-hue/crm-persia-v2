// Deals — queries read-only compartilhadas.

import type { CrmQueryContext } from "./context";

export interface ListDealsOptions {
  /** Filtra por pipeline_id. Default: todos os deals do org. */
  pipelineId?: string;
}

/**
 * Lista deals do org com lead embed (id/name/phone/email/status + tags).
 * Ordena por sort_order ASC (compativel com drag-drop do Kanban).
 */
export async function listDeals(
  ctx: CrmQueryContext,
  opts: ListDealsOptions = {},
): Promise<unknown[]> {
  const { db, orgId } = ctx;

  // Embed do responsavel via assigned_to -> profiles(full_name).
  // Mostrado na linha "Responsavel" do card do Kanban (sem precisar
  // de query extra).
  let query = db
    .from("deals")
    .select(
      "*, leads(id, name, phone, email, status, assigned_to, lead_tags(tags(id, name, color)), assignee:profiles!leads_assigned_to_fkey(id, full_name))",
    )
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (opts.pipelineId) {
    query = query.eq("pipeline_id", opts.pipelineId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
