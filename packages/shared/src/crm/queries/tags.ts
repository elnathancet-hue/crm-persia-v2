// Tags — queries read-only compartilhadas entre apps/crm e apps/admin.

import type { Tag, TagWithCount } from "../types";
import type { CrmQueryContext } from "./context";

export interface ListTagsOptions {
  /**
   * Coluna pra ordenar. CRM usa "created_at" (ordem cronologica reversa,
   * tags novas primeiro). Admin usa "name" (alfabetico).
   * Default: "created_at" desc.
   */
  orderBy?: "name" | "created_at";
}

/**
 * Lista as tags de um org. Throw em qualquer erro de DB.
 */
export async function listTags(
  ctx: CrmQueryContext,
  opts: ListTagsOptions = {},
): Promise<Tag[]> {
  const { db, orgId } = ctx;
  const orderBy = opts.orderBy ?? "created_at";
  const ascending = orderBy === "name";

  const { data, error } = await db
    .from("tags")
    .select("*")
    .eq("organization_id", orgId)
    .order(orderBy, { ascending });

  if (error) throw new Error(error.message);
  return (data ?? []) as Tag[];
}

/**
 * Lista tags com contagem agregada de leads por tag (lead_count).
 * Usa RPC count_tags_for_org que faz GROUP BY no banco — uma unica query,
 * sem transferencia de rows individuais de lead_tags nem risco de cap 1000.
 */
export async function listTagsWithCount(
  ctx: CrmQueryContext,
): Promise<TagWithCount[]> {
  const { db, orgId } = ctx;

  if (!db.rpc) throw new Error("listTagsWithCount: db.rpc is required");

  const [tagsResult, countsResult] = await Promise.all([
    db
      .from("tags")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    db.rpc("count_tags_for_org", { p_org_id: orgId }),
  ]);

  if (tagsResult.error) throw new Error(tagsResult.error.message);
  if (countsResult.error) throw new Error(countsResult.error.message);

  const tags = (tagsResult.data ?? []) as Tag[];
  if (tags.length === 0) return [];

  const countMap: Record<string, number> = {};
  for (const row of (countsResult.data ?? []) as { tag_id: string; lead_count: number }[]) {
    countMap[row.tag_id] = row.lead_count;
  }

  return tags.map((tag) => ({
    ...tag,
    lead_count: countMap[tag.id] ?? 0,
  }));
}
