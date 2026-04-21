"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";


export async function getTags() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin
    .from("tags")
    .select("*")
    .eq("organization_id", orgId)
    .order("name");
  if (error) return [];
  return data || [];
}

export async function createTag(name: string, color: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin
    .from("tags")
    .insert({ organization_id: orgId, name, color })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  revalidatePath("/leads");
  return { data, error: null };
}

export async function addTagToLead(leadId: string, tagId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate lead belongs to active org
  const { data: lead } = await admin
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();
  if (!lead) return { error: "Lead nao encontrado nesta organizacao" };

  const { error } = await admin.from("lead_tags").insert({ lead_id: leadId, tag_id: tagId });
  if (error) return { error: error.message };
  revalidatePath("/leads");
  return { error: null };
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate lead belongs to active org
  const { data: lead } = await admin
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();
  if (!lead) return { error: "Lead nao encontrado nesta organizacao" };

  const { error } = await admin.from("lead_tags").delete().eq("lead_id", leadId).eq("tag_id", tagId);
  if (error) return { error: error.message };
  revalidatePath("/leads");
  return { error: null };
}

export async function updateTag(tagId: string, data: { name?: string; color?: string }) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate tag belongs to active org
  const { data: tag } = await admin
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", orgId)
    .single();
  if (!tag) return { error: "Tag nao encontrada nesta organizacao" };

  const { error } = await admin.from("tags").update(data).eq("id", tagId);
  if (error) return { error: error.message };
  revalidatePath("/tags");
  return { error: null };
}

export async function deleteTag(tagId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Validate tag belongs to active org
  const { data: tag } = await admin
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", orgId)
    .single();
  if (!tag) return { error: "Tag nao encontrada nesta organizacao" };

  await admin.from("lead_tags").delete().eq("tag_id", tagId);
  const { error } = await admin.from("tags").delete().eq("id", tagId);
  if (error) return { error: error.message };
  revalidatePath("/tags");
  return { error: null };
}
