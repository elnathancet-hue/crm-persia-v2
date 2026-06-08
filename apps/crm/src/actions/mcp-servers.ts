"use server";

// MCP — server actions pra CRUD de mcp_server_connections + sync.
//
// PR-FLOW-PIVOT PR 15 (mai/2026): UI em /settings/mcp-servers consome
// esses endpoints. CRUD limitado a admin/owner. Sync chama tools/list
// e persiste cached_tools.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { errorMessage, logError } from "@/lib/observability";
import { asAgentDb } from "@/lib/ai-agent/db";
import {
  discoverTools,
  type McpServerConfig,
  type McpToolDefinition,
} from "@/lib/mcp/client";

// ============================================================================
// Types
// ============================================================================

export interface McpServerRow {
  id: string;
  name: string;
  server_url: string;
  auth_type: "none" | "bearer" | "headers";
  /** auth_token NUNCA é retornado pro client — mantém em backend. */
  has_auth_token: boolean;
  cached_tools: McpToolDefinition[];
  last_synced_at: string | null;
  last_sync_error: string | null;
  is_active: boolean;
  created_at: string;
}

// ============================================================================
// List
// ============================================================================

export async function listMcpServers(): Promise<{
  ok: true;
  servers: McpServerRow[];
} | {
  ok: false;
  error: string;
}> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    const { data, error } = await asAgentDb(supabase)
      .from("mcp_server_connections")
      .select(
        "id, name, server_url, auth_type, auth_token, cached_tools, last_synced_at, last_sync_error, is_active, created_at",
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      const msg = error.message ?? "";
      if (
        /relation .*mcp_server_connections.* does not exist/i.test(msg) ||
        /could not find the table/i.test(msg) ||
        msg.includes("PGRST205")
      ) {
        return { ok: true, servers: [] }; // Migration pendente
      }
      return { ok: false, error: msg };
    }

    const rows = ((data ?? []) as Array<{
      id: string;
      name: string;
      server_url: string;
      auth_type: "none" | "bearer";
      auth_token: string | null;
      cached_tools: unknown;
      last_synced_at: string | null;
      last_sync_error: string | null;
      is_active: boolean;
      created_at: string;
    }>).map<McpServerRow>((r) => ({
      id: r.id,
      name: r.name,
      server_url: r.server_url,
      auth_type: r.auth_type,
      has_auth_token: Boolean(r.auth_token),
      cached_tools: Array.isArray(r.cached_tools)
        ? (r.cached_tools as McpToolDefinition[])
        : [],
      last_synced_at: r.last_synced_at,
      last_sync_error: r.last_sync_error,
      is_active: r.is_active,
      created_at: r.created_at,
    }));

    return { ok: true, servers: rows };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ============================================================================
// Create
// ============================================================================

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  server_url: z
    .string()
    .trim()
    .url("URL inválida")
    .refine(
      (u) => u.startsWith("http://") || u.startsWith("https://"),
      "Deve começar com http:// ou https://",
    ),
  auth_type: z.enum(["none", "bearer", "headers"]).default("none"),
  auth_token: z.string().trim().max(4000).optional(),
});

export async function createMcpServer(input: {
  name: string;
  server_url: string;
  auth_type: "none" | "bearer" | "headers";
  auth_token?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "input inválido" };
    }
    if (parsed.data.auth_type === "bearer" && !parsed.data.auth_token?.trim()) {
      return { ok: false, error: "Bearer requer auth_token preenchido" };
    }
    if (parsed.data.auth_type === "headers" && !parsed.data.auth_token?.trim()) {
      return { ok: false, error: "Headers customizados requerem ao menos um header" };
    }

    const { supabase, orgId, userId } = await requireRole("admin");
    const { data, error } = await asAgentDb(supabase)
      .from("mcp_server_connections")
      .insert({
        organization_id: orgId,
        name: parsed.data.name,
        server_url: parsed.data.server_url,
        auth_type: parsed.data.auth_type,
        auth_token: parsed.data.auth_type !== "none" ? parsed.data.auth_token : null,
        is_active: true,
        created_by_user_id: userId,
      })
      .select("id")
      .single();

    if (error) {
      if (/duplicate key/i.test(error.message) || /unique/i.test(error.message)) {
        return { ok: false, error: "Já existe um servidor com esse nome." };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath("/settings/mcp-servers");
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ============================================================================
// Toggle active
// ============================================================================

export async function toggleMcpServer(
  serverId: string,
  isActive: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!serverId) return { ok: false, error: "serverId inválido" };
  try {
    const { supabase, orgId } = await requireRole("admin");
    const { error } = await asAgentDb(supabase)
      .from("mcp_server_connections")
      .update({ is_active: isActive })
      .eq("organization_id", orgId)
      .eq("id", serverId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings/mcp-servers");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteMcpServer(
  serverId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!serverId) return { ok: false, error: "serverId inválido" };
  try {
    const { supabase, orgId } = await requireRole("admin");
    const { error } = await asAgentDb(supabase)
      .from("mcp_server_connections")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", serverId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings/mcp-servers");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ============================================================================
// Sync — descobre tools + persiste em cached_tools
// ============================================================================

export async function syncMcpServer(
  serverId: string,
): Promise<{
  ok: boolean;
  tools_count?: number;
  error?: string;
}> {
  if (!serverId) return { ok: false, error: "serverId inválido" };
  try {
    const { supabase, orgId } = await requireRole("admin");
    const db = asAgentDb(supabase);

    const { data, error } = await db
      .from("mcp_server_connections")
      .select("id, server_url, auth_type, auth_token")
      .eq("organization_id", orgId)
      .eq("id", serverId)
      .maybeSingle();
    if (error || !data) {
      return { ok: false, error: error?.message ?? "servidor não encontrado" };
    }

    const conn = data as {
      id: string;
      server_url: string;
      auth_type: "none" | "bearer" | "headers";
      auth_token: string | null;
    };

    const config: McpServerConfig = {
      server_url: conn.server_url,
      auth_type: conn.auth_type,
      auth_token: conn.auth_token,
    };

    try {
      const tools = await discoverTools(config);
      await db
        .from("mcp_server_connections")
        .update({
          cached_tools: tools,
          last_synced_at: new Date().toISOString(),
          last_sync_error: null,
        })
        .eq("organization_id", orgId)
        .eq("id", serverId);
      revalidatePath("/settings/mcp-servers");
      return { ok: true, tools_count: tools.length };
    } catch (discoverErr) {
      const errMsg = errorMessage(discoverErr);
      await db
        .from("mcp_server_connections")
        .update({
          last_synced_at: new Date().toISOString(),
          last_sync_error: errMsg.slice(0, 500),
        })
        .eq("organization_id", orgId)
        .eq("id", serverId);
      logError("mcp_sync_failed", {
        organization_id: orgId,
        server_id: serverId,
        error: errMsg,
      });
      revalidatePath("/settings/mcp-servers");
      return { ok: false, error: errMsg };
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
