"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { listTags, listTagsWithCount } from "@persia/shared/crm";

// `getTags` e `getTagsWithCount` sao thin wrappers em volta das queries
// compartilhadas. Auth via requireRole; logica em @persia/shared/crm.
// O parametro `orgId` opcional permite admins multitenancia consultarem
// tags de outras orgs explicitamente — nesse caso passamos pelo orgId
// fornecido em vez do contexto.
export async function getTags(orgId?: string) {
  const ctx = await requireRole("agent");
  const resolvedOrgId = orgId || ctx.orgId;
  return listTags({ db: ctx.supabase, orgId: resolvedOrgId });
}

export async function getTagsWithCount(orgId?: string) {
  const ctx = await requireRole("agent");
  const resolvedOrgId = orgId || ctx.orgId;
  return listTagsWithCount({ db: ctx.supabase, orgId: resolvedOrgId });
}

export async function createTag({ name, color }: { name: string; color: string }) {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("tags")
    .insert({
      organization_id: orgId,
      name,
      color: color || "#6366f1",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tags");
  return data;
}

export async function updateTag(id: string, { name, color }: { name?: string; color?: string }) {
  const { supabase, orgId } = await requireRole("agent");

  const updateData: Record<string, string> = {};
  if (name !== undefined) updateData.name = name;
  if (color !== undefined) updateData.color = color;

  const { error } = await supabase
    .from("tags")
    .update(updateData as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/tags");
  revalidatePath("/leads");
  revalidatePath("/crm");
}

export async function deleteTag(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  // Remove all lead_tags first
  await supabase.from("lead_tags").delete().eq("tag_id", id).eq("organization_id", orgId);

  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/tags");
  revalidatePath("/leads");
  revalidatePath("/crm");
}

export async function addTagToLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!lead) {
    throw new Error("Lead nao encontrado nesta organizacao");
  }

  const { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!tag) {
    throw new Error("Tag nao encontrada nesta organizacao");
  }

  const { error } = await supabase.from("lead_tags").insert({
    lead_id: leadId,
    tag_id: tagId,
    organization_id: orgId,
  });

  if (error) {
    // Ignore duplicate
    if (error.code === "23505") return;
    throw new Error(error.message);
  }

  // Sync tags to UAZAPI (fire and forget)
  import("@/lib/whatsapp/sync").then(({ syncLeadToUazapi }) => {
    syncLeadToUazapi(orgId, leadId);
  }).catch((err) => {
    console.error("[addTagToLead] sync error:", err);
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/crm");
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { error } = await supabase
    .from("lead_tags")
    .delete()
    .eq("lead_id", leadId)
    .eq("tag_id", tagId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);

  // Sync tags to UAZAPI (fire and forget)
  import("@/lib/whatsapp/sync").then(({ syncLeadToUazapi }) => {
    syncLeadToUazapi(orgId, leadId);
  }).catch((err) => {
    console.error("[removeTagFromLead] sync error:", err);
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/crm");
}

export async function getLeadTags(leadId: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("lead_tags")
    .select("tag_id, tags(id, name, color)")
    .eq("lead_id", leadId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  return (data || []).map((lt: any) => lt.tags).flat().filter(Boolean);
}
