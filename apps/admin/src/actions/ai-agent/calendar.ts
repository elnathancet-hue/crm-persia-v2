"use server";

import { revalidatePath } from "next/cache";
import {
  toPublicConnection,
  type AgentCalendarConnection,
  type AgentCalendarConnectionPublic,
} from "@persia/shared/ai-agent";
import { fromAny, type AgentDb } from "@/lib/ai-agent/db";
import {
  agentPaths,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

// ============================================================================
// List connections (org-wide)
// ============================================================================

export async function listCalendarConnections(
  orgId: string,
): Promise<AgentCalendarConnectionPublic[]> {
  const { db } = await requireAdminAgentOrg(orgId);

  const { data, error } = await fromAny(db, "agent_calendar_connections")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as AgentCalendarConnection[]).map((row) =>
    toPublicConnection(row),
  );
}

// ============================================================================
// Delete connection
// ============================================================================

export async function deleteCalendarConnection(
  orgId: string,
  connectionId: string,
): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertConnectionBelongsToOrg(db, orgId, connectionId);

    await deleteVaultSecret(db, existing.encrypted_refresh_token_id);

    const { error } = await fromAny(db, "agent_calendar_connections")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", connectionId);
    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_calendar_connection_delete",
      entityType: "agent_calendar_connection",
      entityId: connectionId,
      metadata: { google_email: existing.google_account_email },
    });

    for (const path of agentPaths()) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_calendar_connection_delete",
      entityType: "agent_calendar_connection",
      entityId: connectionId,
      error,
    });
    throw error;
  }
}

// ============================================================================
// OAuth start URL
// ============================================================================

export async function buildOAuthStartUrl(
  orgId: string,
  returnTo: string,
): Promise<{ url: string }> {
  await requireAdminAgentOrg(orgId);
  // No admin, o redirect tem que voltar pro CRM (que tem o callback).
  // O bridge passa orgId + return_to no state JWT pra o callback saber
  // pra qual org gravar a conexao.
  const safeReturn = returnTo.startsWith("/") ? returnTo : "/automations/agents";
  const params = new URLSearchParams({
    return_to: safeReturn,
    org_id: orgId,
    bridge: "admin",
  });
  // CRM_CLIENT_BASE_URL pra o admin redirecionar pro CRM (onde mora o
  // OAuth flow). Codex implementa o endpoint la.
  const base = process.env.CRM_CLIENT_BASE_URL?.replace(/\/$/, "") ??
    "https://crm.funilpersia.top";
  return { url: `${base}/api/oauth/google/start?${params.toString()}` };
}

// ============================================================================
// Helpers
// ============================================================================

async function assertConnectionBelongsToOrg(
  db: AgentDb,
  orgId: string,
  connectionId: string,
): Promise<AgentCalendarConnection> {
  const { data, error } = await fromAny(db, "agent_calendar_connections")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !data) throw new Error("Conexao nao encontrada");
  return data as AgentCalendarConnection;
}

interface VaultDeletable {
  schema(name: "vault"): {
    from(table: "secrets"): {
      delete(): {
        eq(col: "id", val: string): Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

async function deleteVaultSecret(
  db: AgentDb,
  secretId: string,
): Promise<void> {
  try {
    const adminWithVault = db as unknown as VaultDeletable;
    const { error } = await adminWithVault
      .schema("vault")
      .from("secrets")
      .delete()
      .eq("id", secretId);
    if (error) {
      console.warn("[admin calendar] vault secret delete failed", error.message);
    }
  } catch (err) {
    console.warn("[admin calendar] vault secret delete threw", err);
  }
}
