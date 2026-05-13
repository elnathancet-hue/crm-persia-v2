"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@persia/ui";

function asErrorMessage(err: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export async function getSegments() {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("segments")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function getSegment(id: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("segments")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ============================================================================
// Sprint 3: mutations migram pra ActionResult.
//
// Antes, recebiam FormData (legacy do form HTML) e davam throw em erro.
// Agora aceitam payload tipado (shape de objeto) e retornam ActionResult.
// O adapter @persia/segments-ui ja passa objeto, entao FormData nao
// e mais necessario.
// ============================================================================

interface CreateSegmentPayload {
  name: string;
  description?: string;
  rules: unknown;
}

interface UpdateSegmentPayload {
  name?: string;
  description?: string;
  rules?: unknown;
}

export async function createSegment(
  payload: CreateSegmentPayload,
): Promise<ActionResult<unknown>> {
  try {
    const { supabase, orgId } = await requireRole("admin");

    const { data, error } = await supabase
      .from("segments")
      .insert({
        organization_id: orgId,
        name: payload.name,
        description: payload.description || null,
        rules: (payload.rules ?? { operator: "AND", conditions: [] }) as never,
      } as never)
      .select()
      .single();

    if (error) return { error: error.message };
    revalidatePath("/segments");
    return { data };
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível criar a segmentação.") };
  }
}

export async function updateSegment(
  id: string,
  payload: UpdateSegmentPayload,
): Promise<ActionResult<void>> {
  try {
    const { supabase, orgId } = await requireRole("admin");

    const updates: Record<string, unknown> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.description !== undefined)
      updates.description = payload.description || null;
    if (payload.rules !== undefined) updates.rules = payload.rules;

    const { error } = await supabase
      .from("segments")
      .update(updates as never)
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) return { error: error.message };
    revalidatePath("/segments");
    return;
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível atualizar a segmentação.") };
  }
}

export async function deleteSegment(id: string): Promise<ActionResult<void>> {
  try {
    const { supabase, orgId } = await requireRole("admin");

    const { error } = await supabase
      .from("segments")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) return { error: error.message };
    revalidatePath("/segments");
    return;
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível excluir a segmentação.") };
  }
}
