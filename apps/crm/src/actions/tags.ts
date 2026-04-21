"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getTags(orgId?: string) {
  const ctx = await requireRole("agent");
  const resolvedOrgId = orgId || ctx.orgId;

  const { data, error } = await ctx.supabase
    .from("tags")
    .select("*")
    .eq("organization_id", resolvedOrgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function getTagsWithCount(orgId?: string) {
  const ctx = await requireRole("agent");
  const resolvedOrgId = orgId || ctx.orgId;

  const { data: tags, error } = await ctx.supabase
    .from("tags")
    .select("*")
    .eq("organization_id", resolvedOrgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  if (!tags || tags.length === 0) return [];

  const tagIds = tags.map((t: { id: string }) => t.id);
  const { data: leadTags, error: ltError } = await ctx.supabase
    .from("lead_tags")
    .select("tag_id")
    .in("tag_id", tagIds);

  if (ltError) throw new Error(ltError.message);

  const countMap: Record<string, number> = {};
  (leadTags || []).forEach((lt: { tag_id: string }) => {
    countMap[lt.tag_id] = (countMap[lt.tag_id] || 0) + 1;
  });

  return tags.map((tag: { id: string; name: string; color: string | null; organization_id: string; created_at: string | null }) => ({
    ...tag,
    lead_count: countMap[tag.id] || 0,
  }));
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
  const { supabase } = await requireRole("agent");

  const updateData: Record<string, string> = {};
  if (name !== undefined) updateData.name = name;
  if (color !== undefined) updateData.color = color;

  const { error } = await supabase.from("tags").update(updateData as never).eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/tags");
}

export async function deleteTag(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  // Remove all lead_tags first
  await supabase.from("lead_tags").delete().eq("tag_id", id).eq("organization_id", orgId);

  const { error } = await supabase.from("tags").delete().eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/tags");
}

export async function addTagToLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");

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
}

export async function getLeadTags(leadId: string) {
  const { supabase } = await requireRole("agent");

  const { data, error } = await supabase
    .from("lead_tags")
    .select("tag_id, tags(id, name, color)")
    .eq("lead_id", leadId);

  if (error) throw new Error(error.message);
  return (data || []).map((lt: any) => lt.tags).flat().filter(Boolean);
}
