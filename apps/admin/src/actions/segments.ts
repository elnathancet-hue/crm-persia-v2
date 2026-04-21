"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";


export async function getSegments() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin.from("segments").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
  return data || [];
}

export async function getSegment(segmentId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin.from("segments").select("*").eq("id", segmentId).eq("organization_id", orgId).single();
  if (error) return null;
  return data;
}

export async function createSegment(data: { name: string; description?: string; rules: unknown }) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: segment, error } = await admin.from("segments").insert({
    organization_id: orgId,
    name: data.name,
    description: data.description || null,
    rules: data.rules || { operator: "AND", conditions: [] },
  }).select().single();
  if (error) return { data: null, error: error.message };
  revalidatePath("/segments");
  return { data: segment, error: null };
}

export async function updateSegment(segmentId: string, data: { name?: string; description?: string; rules?: unknown }) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.rules !== undefined) updates.rules = data.rules;

  const { error } = await admin.from("segments").update(updates).eq("id", segmentId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/segments");
  return { error: null };
}

export async function deleteSegment(segmentId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin.from("segments").delete().eq("id", segmentId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/segments");
  return { error: null };
}
