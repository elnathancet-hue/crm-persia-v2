"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getCustomFields() {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("custom_fields")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createCustomField(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const name = formData.get("name") as string;
  const fieldKey = formData.get("field_key") as string;
  const fieldType = formData.get("field_type") as string;
  const optionsRaw = formData.get("options") as string;

  const options = optionsRaw
    ? optionsRaw
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  const { data, error } = await supabase
    .from("custom_fields")
    .insert({
      organization_id: orgId,
      name,
      field_key: fieldKey,
      field_type: fieldType,
      options: fieldType === "select" ? options : [],
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/leads/fields");
  return data;
}

export async function updateCustomField(id: string, formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");

  const updateData: Record<string, any> = {};
  const name = formData.get("name") as string;
  const fieldType = formData.get("field_type") as string;
  const optionsRaw = formData.get("options") as string;

  if (name) updateData.name = name;
  if (fieldType) updateData.field_type = fieldType;
  if (optionsRaw !== null) {
    updateData.options = optionsRaw
      ? optionsRaw
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : [];
  }

  const { error } = await supabase
    .from("custom_fields")
    .update(updateData as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads/fields");
}

export async function deleteCustomField(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  // Remove values first
  await supabase.from("lead_custom_field_values").delete().eq("custom_field_id", id).eq("organization_id", orgId);
  const { error } = await supabase.from("custom_fields").delete().eq("id", id).eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads/fields");
}
