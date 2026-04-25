"use server";

import { revalidatePath } from "next/cache";
import {
  toPublicConnection,
  type AgentCalendarConnection,
  type AgentCalendarConnectionPublic,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "@/lib/ai-agent/db";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  agentPaths,
  requireAgentRole,
} from "./utils";

// ============================================================================
// List connections (org-wide)
// ============================================================================

export async function listCalendarConnections(): Promise<
  AgentCalendarConnectionPublic[]
> {
  const { db, orgId } = await requireAgentRole("agent");

  const { data, error } = await db
    .from("agent_calendar_connections")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as AgentCalendarConnection[]).map((row) =>
    toPublicConnection(row),
  );
}

// ============================================================================
// Delete connection — também limpa o secret no Vault
// ============================================================================

export async function deleteCalendarConnection(
  connectionId: string,
): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertConnectionBelongsToOrg(db, orgId, connectionId);

  // Apaga o secret no Vault primeiro. Se falhar, ainda apaga a row
  // (orphan secret no Vault é preferível a row órfã apontando pra
  // secret deletado).
  await deleteVaultSecret(existing.encrypted_refresh_token_id);

  const { error } = await db
    .from("agent_calendar_connections")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", connectionId);

  if (error) throw new Error(error.message);

  // Não invalido o cache de cada agente individualmente — ON DELETE
  // SET NULL no FK já zera os agent_configs.calendar_connection_id
  // que apontavam pra essa conexão.
  for (const path of agentPaths()) revalidatePath(path);
}

// ============================================================================
// Build OAuth start URL — redirect path o user faz click
// ============================================================================

// O endpoint /api/oauth/google/start (responsabilidade do Codex em
// PR7.3b) recebe ?return_to=<path> e:
// 1. Gera state JWT (CSRF + org_id + return_to + expira em 5min)
// 2. Redirect pra GOOGLE_OAUTH_AUTH_URL com client_id + scope + state
// O callback /api/oauth/google/callback recebe code+state, troca
// por tokens, salva via upsert_calendar_connection RPC.
export async function buildOAuthStartUrl(
  returnTo: string,
): Promise<{ url: string }> {
  await requireAgentRole("admin");
  const safeReturn = returnTo.startsWith("/") ? returnTo : "/automations/agents";
  const params = new URLSearchParams({ return_to: safeReturn });
  return { url: `/api/oauth/google/start?${params.toString()}` };
}

// ============================================================================
// Helpers
// ============================================================================

async function assertConnectionBelongsToOrg(
  db: AgentDb,
  orgId: string,
  connectionId: string,
): Promise<AgentCalendarConnection> {
  const { data, error } = await db
    .from("agent_calendar_connections")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !data) throw new Error("Conexao nao encontrada");
  return data as AgentCalendarConnection;
}

interface VaultDeletable {
  rpc(
    fn: "delete_calendar_secret",
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  schema(name: "vault"): {
    from(table: "secrets"): {
      delete(): {
        eq(col: "id", val: string): Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

async function deleteVaultSecret(secretId: string): Promise<void> {
  // Vault delete via service_role. Se a função RPC não existir
  // (Codex pode adicionar depois), tenta delete direto na tabela
  // vault.secrets. Falhas são best-effort — log mas não bloqueia
  // delete da row principal.
  const admin = createAdminClient() as unknown as VaultDeletable;
  try {
    const { error } = await admin
      .schema("vault")
      .from("secrets")
      .delete()
      .eq("id", secretId);
    if (error) {
      console.warn("[calendar] vault secret delete failed", error.message);
    }
  } catch (err) {
    console.warn("[calendar] vault secret delete threw", err);
  }
}
