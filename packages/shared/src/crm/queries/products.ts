import type { OrgProduct, LeadProduct } from "../types";
import type { CrmQueryContext } from "./context";

export async function listOrgProducts(
  ctx: CrmQueryContext,
  opts: { activeOnly?: boolean } = {},
): Promise<OrgProduct[]> {
  const { db, orgId } = ctx;
  let query = db
    .from("org_products")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  if (opts.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OrgProduct[];
}

export async function listLeadProducts(
  ctx: CrmQueryContext,
  leadId: string,
): Promise<LeadProduct[]> {
  const { db, orgId } = ctx;
  const { data, error } = await db
    .from("lead_products")
    .select("*, org_products(*)")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LeadProduct[];
}
