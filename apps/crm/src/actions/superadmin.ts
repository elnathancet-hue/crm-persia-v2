"use server";

// Server actions de troca de contexto do superadmin.
//
// Habilita o fluxo "sistema unico" da Fase 1: superadmin loga no CRM
// cliente normal, escolhe uma org pra "agir como" via switcher na
// sidebar, e o cookie `superadmin-context` faz com que requireRole()
// resolva orgId pelo cookie em vez do membership.
//
// O fluxo equivalente no antigo apps/admin era:
//   1. Login no admin
//   2. Sidebar -> "Acessar conta" -> escolhe org
//   3. switchAdminContext() seta cookie + redireciona pra /
//
// Agora vai ser:
//   1. Login no CRM cliente
//   2. (se for superadmin) Switcher na sidebar mostra dropdown de orgs
//   3. switchToOrg() seta cookie + revalida UI
//   4. Pode voltar pra "visualizacao global" via clearOrgContext()

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  clearSuperadminContext,
  setSuperadminContext,
} from "@/lib/superadmin-context";

async function assertSuperadmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Nao autenticado");

  const { data } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(data as any)?.is_superadmin) {
    throw new Error("Acesso negado: requer superadmin");
  }
  return { userId: user.id };
}

/**
 * Lista organizacoes disponiveis pro superadmin (todas no DB).
 * Usada pelo switcher de contexto.
 */
export async function listAllOrganizations(): Promise<
  Array<{ id: string; name: string }>
> {
  await assertSuperadmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/**
 * Seta o cookie de impersonacao pra atuar em nome de uma org. Valida
 * que o user eh superadmin e que a org existe. Apos sucesso,
 * `revalidatePath("/")` forca re-render pra a UI refletir o novo
 * contexto.
 */
export async function switchToOrg(orgId: string): Promise<void> {
  const { userId } = await assertSuperadmin();

  // Confirma que a org existe (defesa em profundidade)
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) throw new Error("Organizacao nao encontrada");

  await setSuperadminContext(orgId, userId);
  revalidatePath("/");
}

/**
 * Limpa o cookie de impersonacao. Superadmin volta pra "visualizacao
 * global" (sem org ativa). Use pra sair de "agir como cliente".
 */
export async function clearOrgContext(): Promise<void> {
  await assertSuperadmin();
  await clearSuperadminContext();
  revalidatePath("/");
}

/**
 * Helper de UI: redireciona pra `/dashboard` apos trocar de org.
 * Server action conveniente pra usar em <form action={...}>.
 */
export async function switchToOrgAndGoHome(orgId: string): Promise<void> {
  await switchToOrg(orgId);
  redirect("/dashboard");
}
