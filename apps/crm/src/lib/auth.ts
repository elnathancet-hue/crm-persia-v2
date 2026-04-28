import { createClient } from "@/lib/supabase/server";
import { readSuperadminContext } from "@/lib/superadmin-context";
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
 * Verifica se o user logado eh superadmin (profiles.is_superadmin).
 * Retornar true desbloqueia o cookie de impersonacao em getAuthContext.
 */
async function isSuperadmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", userId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Boolean((data as any)?.is_superadmin);
}

/**
 * Resolve o orgId ativo a partir do cookie de impersonacao do
 * superadmin. So retorna se:
 *   1. user logado e superadmin (profiles.is_superadmin = true)
 *   2. cookie existe + assinatura valida (HMAC + sid binding)
 *   3. cookie.userId bate com a sessao atual
 *
 * Retorna null em qualquer outro caso (caller usa membership normal).
 */
async function resolveSuperadminImpersonation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const sa = await isSuperadmin(supabase, userId);
  if (!sa) return null;

  const ctx = await readSuperadminContext();
  if (!ctx) return null;
  if (ctx.userId !== userId) return null;

  return ctx.orgId;
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
 * Behavior:
 *   - no session             -> redirect("/login")
 *   - SUPERADMIN + cookie     -> usa orgId do cookie de impersonacao
 *                                (role efetivo = "owner" sobre a org alvo)
 *   - membership normal       -> primeira membership (single-org)
 *   - sem nada                -> { orgId: null, role: null }
 *
 * `isSuperadmin` indica se o user logado eh superadmin (independente
 * de impersonacao ativa). UI usa pra mostrar switcher de org.
 */
export async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 1. Tenta resolver via cookie de impersonacao (so disponivel pra
  //    superadmin com cookie valido + sid bind).
  const impersonatedOrgId = await resolveSuperadminImpersonation(
    supabase,
    user.id,
  );
  const userIsSuperadmin = await isSuperadmin(supabase, user.id);

  if (impersonatedOrgId) {
    return {
      supabase,
      user,
      orgId: impersonatedOrgId,
      userId: user.id,
      // Superadmin atuando em nome do cliente — concede role maximo
      // (owner) sobre a org alvo. Permite editar tudo.
      role: "owner" as OrgRole,
      memberships: [] as MembershipRow[],
      isSuperadmin: true,
      isImpersonating: true,
    };
  }

  // 2. Fluxo normal: pega primeira membership do user.
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
      isSuperadmin: userIsSuperadmin,
      isImpersonating: false,
    };
  }

  return {
    supabase,
    user,
    orgId: active.organization_id,
    userId: user.id,
    role: active.role,
    memberships,
    isSuperadmin: userIsSuperadmin,
    isImpersonating: false,
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

  // Superadmin com cookie de impersonacao tem acesso "owner" a org
  // alvo (bypassa qualquer minRole). Mesmo padrao do antigo
  // requireSuperadminForOrg() — auth via cookie assinado, nao via
  // organization_members.
  const impersonatedOrgId = await resolveSuperadminImpersonation(
    supabase,
    user.id,
  );
  if (impersonatedOrgId) {
    return {
      supabase,
      user,
      orgId: impersonatedOrgId,
      userId: user.id,
      role: "owner" as OrgRole,
      memberships: [] as MembershipRow[],
      isSuperadmin: true,
      isImpersonating: true,
    };
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
    isSuperadmin: false,
    isImpersonating: false,
  };
}
