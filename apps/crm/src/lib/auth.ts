import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type OrgRole = "owner" | "admin" | "agent" | "viewer";

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 40,
  admin: 30,
  agent: 20,
  viewer: 10,
};

/**
 * Returns auth context with org membership. Does NOT enforce a minimum role.
 * Use this for read-only operations accessible to all members (including viewers).
 */
export async function getAuthContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!member) {
    return { supabase, user, orgId: null, userId: user.id, role: null };
  }

  return {
    supabase,
    user,
    orgId: member.organization_id as string,
    userId: user.id,
    role: member.role as OrgRole,
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
 *   const ctx = await requireRole("viewer"); // everyone can access (same as getAuthContext)
 */
export async function requireRole(minRole: OrgRole) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Nao autenticado");
  }

  // Architectural note: single-org model. .single() assumes each user belongs
  // to exactly one org. Multi-org would require orgId param (+ context cookie).
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!member) {
    throw new Error("Sem organizacao");
  }

  const userRole = member.role as OrgRole;
  const userLevel = ROLE_HIERARCHY[userRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[minRole];

  if (userLevel < requiredLevel) {
    throw new Error("Permissao insuficiente");
  }

  return {
    supabase,
    user,
    orgId: member.organization_id as string,
    userId: user.id,
    role: userRole,
  };
}
