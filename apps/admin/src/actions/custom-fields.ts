"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";


export async function getCustomFields() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin.from("custom_fields").select("*").eq("organization_id", orgId).order("sort_order", { ascending: true });
  return data || [];
}

export async function createCustomField(data: {
  name: string; field_key: string; field_type: string; options?: string; is_required?: boolean;
}) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const options = data.field_type === "select" || data.field_type === "multi_select"
    ? (data.options || "").split(",").map(o => o.trim()).filter(Boolean)
    : null;

  const { data: field, error } = await admin.from("custom_fields").insert({
    organization_id: orgId,
    name: data.name,
    field_key: data.field_key,
    field_type: data.field_type,
    options,
    is_required: data.is_required || false,
  }).select().single();

  if (error) return { data: null, error: error.message };
  revalidatePath("/leads/fields");
  return { data: field, error: null };
}

export async function updateCustomField(fieldId: string, data: { name?: string; field_type?: string; options?: string; is_required?: boolean }) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.field_type !== undefined) updates.field_type = data.field_type;
  if (data.is_required !== undefined) updates.is_required = data.is_required;
  if (data.options !== undefined) {
    updates.options = data.options.split(",").map(o => o.trim()).filter(Boolean);
  }

  const { error } = await admin.from("custom_fields").update(updates).eq("id", fieldId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/leads/fields");
  return { error: null };
}

export async function deleteCustomField(fieldId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate field belongs to active org
  const { data: field } = await admin
    .from("custom_fields")
    .select("id")
    .eq("id", fieldId)
    .eq("organization_id", orgId)
    .single();
  if (!field) return { error: "Campo nao encontrado nesta organizacao" };

  // Cascade: delete values first, then field
  await admin.from("lead_custom_field_values").delete().eq("custom_field_id", fieldId);
  const { error } = await admin.from("custom_fields").delete().eq("id", fieldId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/leads/fields");
  return { error: null };
}
