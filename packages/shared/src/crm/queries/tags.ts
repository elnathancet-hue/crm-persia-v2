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
 * Lista tags com contagem agregada de leads por tag (lead_count). Faz
 * em duas etapas (tags + lead_tags) pra nao depender de funcoes RPC e
 * funcionar em ambos os apps com seus respectivos clients.
 */
export async function listTagsWithCount(
  ctx: CrmQueryContext,
): Promise<TagWithCount[]> {
  const { db, orgId } = ctx;

  const { data: tags, error } = await db
    .from("tags")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!tags || tags.length === 0) return [];

  const tagIds = (tags as { id: string }[]).map((t) => t.id);
  const { data: leadTags, error: ltError } = await db
    .from("lead_tags")
    .select("tag_id")
    .in("tag_id", tagIds);

  if (ltError) throw new Error(ltError.message);

  const countMap: Record<string, number> = {};
  for (const lt of (leadTags ?? []) as { tag_id: string }[]) {
    countMap[lt.tag_id] = (countMap[lt.tag_id] ?? 0) + 1;
  }

  return (tags as Tag[]).map((tag) => ({
    ...tag,
    lead_count: countMap[tag.id] ?? 0,
  }));
}
