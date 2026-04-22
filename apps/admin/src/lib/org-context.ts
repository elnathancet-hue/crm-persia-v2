import "server-only";

import { getAdmin, type AdminClient } from "@/lib/supabase-admin";
import { readAdminContext } from "@/lib/admin-context";

/**
 * org context resolution sources, in priority order.
 *
 *   "explicit"  caller passes an orgId (eg. switchAdminContext(orgId))
 *   "cookie"    signed admin-context cookie set via setAdminContext()
 *   "member"    only org the user is an active member of
 *
 * The "member" path is what the CRM uses today via organization_members.
 * Adding it here lets us share the resolver between admin & CRM in the
 * future without forcing a migration today.
 */
export type OrgSource = "explicit" | "cookie" | "member";

export interface OrgContext {
  orgId: string;
  source: OrgSource;
}

export interface ResolveOrgOptions {
  /** Explicit orgId — wins if provided AND validated. */
  explicit?: string;
  /** Caller user id — required when allowing the "member" fallback. */
  userId?: string;
  /** Allowed sources. Defaults: ["explicit", "cookie"] (admin behavior). */
  allow?: OrgSource[];
  /**
   * If true, throws when no org could be resolved. If false, returns null
   * (used in shells that render an empty state).
   */
  required?: boolean;
}

/**
 * Resolve the active org from the configured sources.
 *
 * Always validates that the resolved orgId still exists in `organizations`
 * (cookies and member rows can outlive their org).
 */
export async function resolveOrgContext(
  opts: ResolveOrgOptions = {}
): Promise<OrgContext | null> {
  const allow = opts.allow ?? ["explicit", "cookie"];
  const admin = getAdmin();

  let orgId: string | null = null;
  let source: OrgSource | null = null;

  // 1. Explicit (eg. switching context)
  if (allow.includes("explicit") && opts.explicit) {
    orgId = opts.explicit;
    source = "explicit";
  }

  // 2. Signed cookie (admin panel)
  if (!orgId && allow.includes("cookie")) {
    const ctx = await readAdminContext();
    if (ctx?.orgId) {
      // Cookie userId/sid validation lives in admin-context.ts; this
      // function only cares about org resolution.
      orgId = ctx.orgId;
      source = "cookie";
    }
  }

  // 3. Member fallback (single-org users — same path requireRole takes)
  if (!orgId && allow.includes("member") && opts.userId) {
    const { data } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", opts.userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data?.organization_id) {
      orgId = data.organization_id;
      source = "member";
    }
  }

  if (!orgId || !source) {
    if (opts.required) throw new Error("Sem contexto de organizacao ativo");
    return null;
  }

  // Validate org still exists (cookie may outlive deleted org)
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();

  if (!org) {
    if (opts.required) throw new Error("Organizacao do contexto nao encontrada");
    return null;
  }

  return { orgId, source };
}

/**
 * List orgs the user is a member of. Returned in stable order
 * (created_at asc) so UI dropdowns are deterministic.
 *
 * Today every CRM user has 0 or 1 orgs — but this helper is the
 * structural seam where multi-org will plug in.
 */
export async function listUserOrgs(userId: string): Promise<
  Array<{ orgId: string; role: string; orgName: string }>
> {
  const admin = getAdmin();
  const { data, error } = await admin
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  type Row = {
    organization_id: string;
    role: string;
    organizations: { name: string } | null;
  };

  return (data as unknown as Row[])
    .filter((r) => !!r.organization_id)
    .map((r) => ({
      orgId: r.organization_id,
      role: r.role,
      orgName: r.organizations?.name ?? "",
    }));
}

/**
 * Re-export so callers don't need a second import to spell out the type.
 */
export type { AdminClient };
