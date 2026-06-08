"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { asAgentDb } from "@/lib/ai-agent/db";

// ============================================================================
// Types
// ============================================================================

export interface CaptureSourceRow {
  id: string;
  name: string;
  api_key_id: string;
  /** key_prefix da api_key vinculada — exibido na tabela. */
  api_key_prefix: string;
  pipeline_id: string | null;
  stage_id: string | null;
  tag_ids: string[];
  dedup_window_hours: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCaptureSourceInput {
  name: string;
  api_key_id: string;
  pipeline_id?: string | null;
  stage_id?: string | null;
  tag_ids?: string[];
  dedup_window_hours?: number;
}

export interface UpdateCaptureSourceInput {
  name?: string;
  api_key_id?: string;
  pipeline_id?: string | null;
  stage_id?: string | null;
  tag_ids?: string[];
  dedup_window_hours?: number;
}

type OkResult<T> = { ok: true } & T;
type ErrResult = { ok: false; error: string };

// ============================================================================
// List
// ============================================================================

export async function listCaptureSources(): Promise<CaptureSourceRow[]> {
  const { supabase, orgId } = await requireRole("admin");
  const db = asAgentDb(supabase);

  // Join com api_keys pra exibir o prefixo sem expor o hash
  const { data, error } = await db
    .from("capture_sources")
    .select("id, name, api_key_id, pipeline_id, stage_id, tag_ids, dedup_window_hours, created_at, updated_at, api_keys(key_prefix)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    api_key_id: row.api_key_id as string,
    api_key_prefix: (row.api_keys as Record<string, string> | null)?.key_prefix ?? "—",
    pipeline_id: (row.pipeline_id as string | null) ?? null,
    stage_id: (row.stage_id as string | null) ?? null,
    tag_ids: Array.isArray(row.tag_ids) ? (row.tag_ids as string[]) : [],
    dedup_window_hours: (row.dedup_window_hours as number) ?? 24,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }));
}

// ============================================================================
// Create
// ============================================================================

export async function createCaptureSource(
  input: CreateCaptureSourceInput,
): Promise<OkResult<{ record: CaptureSourceRow }> | ErrResult> {
  try {
    const { supabase, orgId } = await requireRole("admin");
    const db = asAgentDb(supabase);

    const trimmedName = input.name.trim();
    if (!trimmedName) return { ok: false, error: "Nome é obrigatório" };
    if (trimmedName.length > 100) return { ok: false, error: "Nome muito longo (máx. 100 chars)" };
    if (!input.api_key_id) return { ok: false, error: "Chave de API é obrigatória" };

    // Validar que a chave pertence a esta org
    const { data: keyCheck } = await db
      .from("api_keys")
      .select("id")
      .eq("id", input.api_key_id)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .maybeSingle();

    if (!keyCheck) return { ok: false, error: "Chave de API inválida" };

    const { data, error } = await db
      .from("capture_sources")
      .insert({
        organization_id: orgId,
        name: trimmedName,
        api_key_id: input.api_key_id,
        pipeline_id: input.pipeline_id ?? null,
        stage_id: input.stage_id ?? null,
        tag_ids: input.tag_ids ?? [],
        dedup_window_hours: input.dedup_window_hours ?? 24,
      })
      .select("id, name, api_key_id, pipeline_id, stage_id, tag_ids, dedup_window_hours, created_at, updated_at")
      .single();

    if (error) return { ok: false, error: error.message };

    const row = data as Record<string, unknown>;
    const record: CaptureSourceRow = {
      id: row.id as string,
      name: row.name as string,
      api_key_id: row.api_key_id as string,
      api_key_prefix: input.api_key_id.slice(0, 12), // será sobrescrito no refetch
      pipeline_id: (row.pipeline_id as string | null) ?? null,
      stage_id: (row.stage_id as string | null) ?? null,
      tag_ids: Array.isArray(row.tag_ids) ? (row.tag_ids as string[]) : [],
      dedup_window_hours: (row.dedup_window_hours as number) ?? 24,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };

    revalidatePath("/settings/capture-sources");
    return { ok: true, record };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro ao criar origem" };
  }
}

// ============================================================================
// Update
// ============================================================================

export async function updateCaptureSource(
  id: string,
  input: UpdateCaptureSourceInput,
): Promise<{ ok: true } | ErrResult> {
  try {
    const { supabase, orgId } = await requireRole("admin");
    const db = asAgentDb(supabase);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) return { ok: false, error: "Nome é obrigatório" };
      updates.name = trimmed;
    }
    if (input.api_key_id !== undefined) updates.api_key_id = input.api_key_id;
    if ("pipeline_id" in input) updates.pipeline_id = input.pipeline_id ?? null;
    if ("stage_id" in input) updates.stage_id = input.stage_id ?? null;
    if (input.tag_ids !== undefined) updates.tag_ids = input.tag_ids;
    if (input.dedup_window_hours !== undefined) updates.dedup_window_hours = input.dedup_window_hours;

    const { error } = await db
      .from("capture_sources")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/settings/capture-sources");
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro ao atualizar origem" };
  }
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteCaptureSource(id: string): Promise<{ ok: true } | ErrResult> {
  try {
    const { supabase, orgId } = await requireRole("admin");
    const db = asAgentDb(supabase);

    const { error } = await db
      .from("capture_sources")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/settings/capture-sources");
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro ao excluir origem" };
  }
}
