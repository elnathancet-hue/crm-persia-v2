"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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

export async function createSegment(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("segments")
    .insert({
      organization_id: orgId,
      name: formData.get("name") as string,
      description: formData.get("description") as string || null,
      rules: JSON.parse(formData.get("rules") as string || '{"operator":"AND","conditions":[]}'),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/segments");
  return data;
}

export async function updateSegment(id: string, formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase
    .from("segments")
    .update({
      name: formData.get("name") as string,
      description: formData.get("description") as string || null,
      rules: JSON.parse(formData.get("rules") as string || '{"operator":"AND","conditions":[]}'),
    })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/segments");
}

export async function deleteSegment(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  const { error } = await supabase
    .from("segments")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/segments");
}
