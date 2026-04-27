"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  addTagToLead as addTagToLeadShared,
  createTag as createTagShared,
  deleteTag as deleteTagShared,
  listTags,
  listTagsWithCount,
  removeTagFromLead as removeTagFromLeadShared,
  updateTag as updateTagShared,
} from "@persia/shared/crm";

// Helper: callback fire-and-forget pra UAZAPI sync apos
// add/removeTagToLead. Carregado dinamicamente.
function makeOnLeadChanged(orgId: string) {
  return (leadId: string) => {
    import("@/lib/whatsapp/sync")
      .then(({ syncLeadToUazapi }) => syncLeadToUazapi(orgId, leadId))
      .catch((err) => console.error("[tag-action] sync error:", err));
  };
}

// ============================================================================
// Queries
// ============================================================================

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

export async function getLeadTags(leadId: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("lead_tags")
    .select("tag_id, tags(id, name, color)")
    .eq("lead_id", leadId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  return (data || []).map((lt: { tags: unknown }) => lt.tags).flat().filter(Boolean);
}

// ============================================================================
// Mutations — thin wrappers em volta de @persia/shared/crm
// ============================================================================

export async function createTag({ name, color }: { name: string; color: string }) {
  const { supabase, orgId } = await requireRole("agent");
  const tag = await createTagShared({ db: supabase, orgId }, { name, color });
  revalidatePath("/tags");
  return tag;
}

export async function updateTag(id: string, { name, color }: { name?: string; color?: string }) {
  const { supabase, orgId } = await requireRole("agent");
  await updateTagShared({ db: supabase, orgId }, id, { name, color });
  revalidatePath("/tags");
  revalidatePath("/leads");
  revalidatePath("/crm");
}

export async function deleteTag(id: string) {
  const { supabase, orgId } = await requireRole("admin");
  await deleteTagShared({ db: supabase, orgId }, id);
  revalidatePath("/tags");
  revalidatePath("/leads");
  revalidatePath("/crm");
}

export async function addTagToLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");
  await addTagToLeadShared(
    { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
    leadId,
    tagId,
  );
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/crm");
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");
  await removeTagFromLeadShared(
    { db: supabase, orgId, onLeadChanged: makeOnLeadChanged(orgId) },
    leadId,
    tagId,
  );
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/crm");
}
