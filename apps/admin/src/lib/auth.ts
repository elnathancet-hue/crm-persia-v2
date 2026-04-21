"use server";

import { createClient } from "@/lib/supabase-server";
import { getAdmin } from "@/lib/supabase-admin";
import { readAdminContext } from "@/lib/admin-context";

/**
 * Verifies the current user is authenticated and is a superadmin.
 * If orgId is provided, validates it exists in the database.
 * Returns the admin (service_role) Supabase client.
 * Throws on auth failure or invalid orgId.
 */
export async function requireSuperadmin(orgId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Nao autenticado");

  const admin = getAdmin();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("[Auth] Profile query error:", error.message);
    throw new Error("Erro ao verificar permissao");
  }
  if (!profile?.is_superadmin) throw new Error("Acesso negado");

  // Validate orgId exists in the database if provided
  if (orgId) {
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id")
      .eq("id", orgId)
      .single();
    if (orgError || !org) {
      console.error("[Auth] Invalid orgId:", orgId);
      throw new Error("Organizacao nao encontrada");
    }
  }

  return admin;
}

/**
 * Same as requireSuperadmin but also returns the authenticated user's ID.
 * Used by actions that need to track who performed the action (e.g. messages).
 */
export async function requireSuperadminWithUser(orgId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Nao autenticado");

  const admin = getAdmin();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("[Auth] Profile query error:", error.message);
    throw new Error("Erro ao verificar permissao");
  }
  if (!profile?.is_superadmin) throw new Error("Acesso negado");

  // Validate orgId exists in the database if provided
  if (orgId) {
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id")
      .eq("id", orgId)
      .single();
    if (orgError || !org) {
      console.error("[Auth] Invalid orgId:", orgId);
      throw new Error("Organizacao nao encontrada");
    }
  }

  return { admin, userId: user.id };
}

/**
 * Reads the active org from the signed admin-context cookie.
 * Validates:
 *   1. User is authenticated and is_superadmin
 *   2. Cookie exists and signature is valid (HMAC with ADMIN_CONTEXT_SECRET)
 *   3. Cookie is not expired (TTL 8h)
 *   4. Cookie userId matches the current authenticated user
 *   5. orgId still exists in the database
 *
 * Use this for actions that operate on the active org context.
 * The orgId comes from the server-side cookie, NOT from the frontend.
 */
export async function requireSuperadminForOrg() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Nao autenticado");

  const admin = getAdmin();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("[Auth] Profile query error:", error.message);
    throw new Error("Erro ao verificar permissao");
  }
  if (!profile?.is_superadmin) throw new Error("Acesso negado");

  // Read org from signed cookie
  const ctx = await readAdminContext();
  if (!ctx) {
    throw new Error("Nenhum contexto ativo. Selecione um cliente no painel.");
  }

  // Verify cookie userId matches current authenticated user
  if (ctx.userId !== user.id) {
    throw new Error("Contexto invalido — sessao diferente do cookie.");
  }

  // Validate org still exists
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("id", ctx.orgId)
    .single();
  if (orgError || !org) {
    throw new Error("Organizacao do contexto nao encontrada.");
  }

  return { admin, userId: user.id, orgId: ctx.orgId };
}
