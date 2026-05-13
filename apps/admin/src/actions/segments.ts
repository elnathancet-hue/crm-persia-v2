"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@persia/ui";

function asErrorMessage(err: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export async function getSegments() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin
    .from("segments")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  return data || [];
}

export async function getSegment(segmentId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin
    .from("segments")
    .select("*")
    .eq("id", segmentId)
    .eq("organization_id", orgId)
    .single();
  if (error) return null;
  return data;
}

export async function createSegment(payload: {
  name: string;
  description?: string;
  rules: unknown;
}): Promise<ActionResult<unknown>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const { data, error } = await admin
      .from("segments")
      .insert({
        organization_id: orgId,
        name: payload.name,
        description: payload.description || null,
        rules: payload.rules || { operator: "AND", conditions: [] },
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
  segmentId: string,
  payload: { name?: string; description?: string; rules?: unknown },
): Promise<ActionResult<void>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.description !== undefined) updates.description = payload.description;
    if (payload.rules !== undefined) updates.rules = payload.rules;

    const { error } = await admin
      .from("segments")
      .update(updates)
      .eq("id", segmentId)
      .eq("organization_id", orgId);
    if (error) return { error: error.message };
    revalidatePath("/segments");
    return;
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível atualizar a segmentação.") };
  }
}

export async function deleteSegment(segmentId: string): Promise<ActionResult<void>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const { error } = await admin
      .from("segments")
      .delete()
      .eq("id", segmentId)
      .eq("organization_id", orgId);
    if (error) return { error: error.message };
    revalidatePath("/segments");
    return;
  } catch (err) {
    return { error: asErrorMessage(err, "Não foi possível excluir a segmentação.") };
  }
}
