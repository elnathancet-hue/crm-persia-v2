import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type OrgRole = "owner" | "admin" | "agent" | "viewer";

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 40,
  admin: 30,
  agent: 20,
  viewer: 10,
};

interface MembershipRow {
  organization_id: string;
  role: OrgRole;
}

/**
 * Loads all active memberships for the user, ordered deterministically
 * (created_at asc — oldest first). The CRM is single-org today, but
 * structuring around an array unblocks multi-org without a re-rewrite.
 *
 * Returns [] if the user has no memberships.
 */
async function loadMemberships(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<MembershipRow[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data
    .filter((r) => !!r.organization_id)
    .map((r) => ({
      organization_id: r.organization_id as string,
      role: r.role as OrgRole,
    }));
}

/**
 * Picks the active membership from a list. Single-org today: just the
 * first one. When multi-org lands, replace this with a cookie-driven
 * selector (mirroring admin's signed admin-context cookie).
 */
function pickActiveMembership(memberships: MembershipRow[]): MembershipRow | null {
  return memberships[0] ?? null;
}

/**
 * Returns auth context with org membership. Does NOT enforce a minimum role.
 * Use this for read-only operations accessible to all members (including viewers).
 *
 * Behavior on failure:
 *   - no session       -> redirect("/login")  (page-level helper)
 *   - no membership    -> returns { orgId: null, role: null }
 *   - multi-membership -> returns first (oldest), exposes all via `memberships`
 *
 * Caller can inspect `memberships` to render an org switcher.
 */
export async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const memberships = await loadMemberships(supabase, user.id);
  const active = pickActiveMembership(memberships);

  if (!active) {
    return {
      supabase,
      user,
      orgId: null,
      userId: user.id,
      role: null,
      memberships: [] as MembershipRow[],
    };
  }

  return {
    supabase,
    user,
    orgId: active.organization_id,
    userId: user.id,
    role: active.role,
    memberships,
  };
}

/**
 * Enforces a minimum role for the current user within their organization.
 * Throws if the user is not authenticated, has no org, or has insufficient permissions.
 *
 * Role hierarchy: owner (40) > admin (30) > agent (20) > viewer (10)
 *
 * Usage:
 *   const ctx = await requireRole("admin");  // owner and admin can access
 *   const ctx = await requireRole("agent");  // owner, admin, and agent can access
 *   const ctx = await requireRole("viewer"); // anyone with org access
 *
 * Behavior change vs. legacy: no longer uses .single() on
 * organization_members, so users with 0 or >1 memberships do not 500.
 * The first (oldest) membership is selected — same effective behavior
 * for current single-org users.
 */
export async function requireRole(minRole: OrgRole) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Nao autenticado");
  }

  const memberships = await loadMemberships(supabase, user.id);
  const active = pickActiveMembership(memberships);

  if (!active) {
    throw new Error("Sem organizacao");
  }

  const userLevel = ROLE_HIERARCHY[active.role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minRole];

  if (userLevel < requiredLevel) {
    throw new Error("Permissao insuficiente");
  }

  return {
    supabase,
    user,
    orgId: active.organization_id,
    userId: user.id,
    role: active.role,
    memberships,
  };
}
