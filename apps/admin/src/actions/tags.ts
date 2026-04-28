"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
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

function asErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Erro desconhecido";
}

export async function getTags() {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    return await listTags({ db: admin, orgId }, { orderBy: "name" });
  } catch {
    return [];
  }
}

export async function getTagsWithCount() {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    return await listTagsWithCount({ db: admin, orgId });
  } catch {
    return [];
  }
}

export async function createTag(name: string, color: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const tag = await createTagShared({ db: admin, orgId }, { name, color });
    revalidatePath("/tags");
    revalidatePath("/leads");
    revalidatePath("/crm");
    return { data: tag, error: null };
  } catch (err) {
    return { data: null, error: asErrorMessage(err) };
  }
}

export async function addTagToLead(leadId: string, tagId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await addTagToLeadShared({ db: admin, orgId }, leadId, tagId);
    revalidatePath("/leads");
    revalidatePath("/crm");
    return { error: null };
  } catch (err) {
    return { error: asErrorMessage(err) };
  }
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await removeTagFromLeadShared({ db: admin, orgId }, leadId, tagId);
    revalidatePath("/leads");
    revalidatePath("/crm");
    return { error: null };
  } catch (err) {
    return { error: asErrorMessage(err) };
  }
}

export async function updateTag(tagId: string, data: { name?: string; color?: string }) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updateTagShared({ db: admin, orgId }, tagId, data);
    revalidatePath("/tags");
    revalidatePath("/leads");
    revalidatePath("/crm");
    return { error: null };
  } catch (err) {
    return { error: asErrorMessage(err) };
  }
}

export async function deleteTag(tagId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await deleteTagShared({ db: admin, orgId }, tagId);
    revalidatePath("/tags");
    revalidatePath("/leads");
    revalidatePath("/crm");
    return { error: null };
  } catch (err) {
    return { error: asErrorMessage(err) };
  }
}
