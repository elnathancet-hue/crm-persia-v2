"use server";

import { createClient } from "@/lib/supabase-server";
import { withAdmin, type AdminClient } from "@/lib/supabase-admin";
import { readAdminContext } from "@/lib/admin-context";
import { resolveOrgContext } from "@/lib/org-context";

/**
 * Auth helpers for the admin panel.
 *
 * Hierarchy:
 *   - assertSuperadmin()         lowest-level guard, returns { admin, userId }
 *   - requireSuperadmin(orgId?)  back-compat wrapper, validates orgId if given
 *   - requireSuperadminWithUser  same but always exposes userId
 *   - requireSuperadminForOrg()  reads org from signed cookie + validates
 *
 * All wrappers exist for source-compat with existing call sites
 * (~40 actions across the admin app). DO NOT remove without grepping.
 */

interface SuperadminGuardResult {
  admin: AdminClient;
  userId: string;
}

/**
 * Single-source auth check: confirms session + is_superadmin flag.
 * Returns the service-role client and authenticated userId.
 *
 * Throws on:
 *   - missing/invalid session
 *   - user not in profiles
 *   - profile.is_superadmin = false
 */
async function assertSuperadmin(): Promise<SuperadminGuardResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Nao autenticado");

  const { admin, profile, error } = await withAdmin("auth_assert_superadmin", async (admin) => {
    const result = await admin
      .from("profiles")
      .select("is_superadmin")
      .eq("id", user.id)
      .maybeSingle();
    return { admin, profile: result.data, error: result.error };
  });

  if (error) {
    console.error("[Auth] Profile query error:", error.message);
    throw new Error("Erro ao verificar permissao");
  }
  if (!profile?.is_superadmin) throw new Error("Acesso negado");

  return { admin, userId: user.id };
}

/**
 * Validates that the given orgId exists. Pure DB check (uses service_role
 * so RLS doesn't hide the org from us during validation).
 */
async function assertOrgExists(admin: AdminClient, orgId: string): Promise<void> {
  const { data: org, error } = await admin
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !org) {
    console.error("[Auth] Invalid orgId:", orgId, error?.message);
    throw new Error("Organizacao nao encontrada");
  }
}

/**
 * Verifies the current user is authenticated and is a superadmin.
 * If orgId is provided, validates it exists in the database.
 * Returns the admin (service_role) Supabase client.
 */
export async function requireSuperadmin(orgId?: string): Promise<AdminClient> {
  const { admin } = await assertSuperadmin();
  if (orgId) await assertOrgExists(admin, orgId);
  return admin;
}

/**
 * Same as requireSuperadmin but also returns the authenticated user's ID.
 * Used by actions that need to track who performed the action.
 */
export async function requireSuperadminWithUser(
  orgId?: string
): Promise<{ admin: AdminClient; userId: string }> {
  const { admin, userId } = await assertSuperadmin();
  if (orgId) await assertOrgExists(admin, orgId);
  return { admin, userId };
}

/**
 * Reads the active org from the signed admin-context cookie.
 *
 * Validates:
 *   1. User is authenticated and is_superadmin
 *   2. Cookie exists and signature is valid (HMAC with ADMIN_CONTEXT_SECRET)
 *   3. Cookie is not expired (TTL 8h)
 *   4. Cookie userId matches the current authenticated user
 *   5. (v2 only) Cookie sid matches the current auth session fingerprint
 *   6. orgId still exists in the database
 *
 * The orgId comes from the server-side cookie, NEVER from the frontend.
 */
export async function requireSuperadminForOrg(explicitOrgId?: string): Promise<{
  admin: AdminClient;
  userId: string;
  orgId: string;
}> {
  const { admin, userId } = await assertSuperadmin();

  // Read the signed cookie. readAdminContext also validates sid against
  // the current session (when the cookie is v2).
  const ctx = await readAdminContext();
  if (!ctx) {
    throw new Error("Nenhum contexto ativo. Selecione um cliente no painel.");
  }

  if (ctx.userId !== userId) {
    throw new Error("Contexto invalido — sessao diferente do cookie.");
  }

  if (explicitOrgId && ctx.orgId !== explicitOrgId) {
    throw new Error("Contexto invalido para a organizacao solicitada.");
  }

  // resolveOrgContext also validates that the org still exists.
  const resolved = await resolveOrgContext({
    explicit: explicitOrgId ?? ctx.orgId,
    allow: ["explicit"],
    required: true,
  });

  return { admin, userId, orgId: resolved!.orgId };
}
