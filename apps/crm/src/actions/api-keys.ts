"use server";

import { randomBytes, createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { asAgentDb } from "@/lib/ai-agent/db";

// ============================================================================
// Types
// ============================================================================

export interface ApiKeyRow {
  id: string;
  name: string;
  /** Primeiros 12 chars da chave original (ex: "pk_live_abc1"). Nao secret. */
  key_prefix: string;
  is_active: boolean;
  rate_limit_per_hour: number;
  created_at: string;
  last_used_at: string | null;
}

// ============================================================================
// List
// ============================================================================

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const { supabase, orgId } = await requireRole("admin");
  const db = asAgentDb(supabase);

  const { data, error } = await db
    .from("api_keys")
    .select(
      "id, name, key_prefix, is_active, rate_limit_per_hour, created_at, last_used_at",
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []) as ApiKeyRow[];
}

// ============================================================================
// Create
// ============================================================================

export async function createApiKey(name: string): Promise<{
  ok: true;
  /** Chave completa — exibida UMA UNICA VEZ. Nao armazenada no DB. */
  fullKey: string;
  record: ApiKeyRow;
} | {
  ok: false;
  error: string;
}> {
  try {
    const { supabase, orgId, userId } = await requireRole("admin");
    const db = asAgentDb(supabase);

    const trimmedName = name.trim();
    if (!trimmedName) return { ok: false, error: "Nome é obrigatório" };
    if (trimmedName.length > 100) return { ok: false, error: "Nome muito longo (máx. 100 chars)" };

    // Gerar chave: pk_live_ + 24 bytes hex = 56 chars total, 192 bits de entropia
    const rawKey = `pk_live_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    // 12 chars incluindo o prefixo "pk_live_" (8) + 4 chars hex
    const keyPrefix = rawKey.slice(0, 12);

    const { data, error } = await db
      .from("api_keys")
      .insert({
        organization_id: orgId,
        name: trimmedName,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        created_by: userId,
        is_active: true,
        rate_limit_per_hour: 200,
      })
      .select("id, name, key_prefix, is_active, rate_limit_per_hour, created_at, last_used_at")
      .single();

    if (error) return { ok: false, error: error.message };

    revalidatePath("/settings/api-keys");
    return { ok: true, fullKey: rawKey, record: data as ApiKeyRow };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Erro ao criar chave",
    };
  }
}

// ============================================================================
// Revoke
// ============================================================================

export async function revokeApiKey(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, orgId } = await requireRole("admin");
    const db = asAgentDb(supabase);

    const { error } = await db
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/settings/api-keys");
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Erro ao revogar chave",
    };
  }
}
