// Tags — mutations compartilhadas entre apps/crm e apps/admin.
//
// Throw em qualquer erro de DB. Validam org-scoping + cross-resource
// (tag pertence ao org, lead pertence ao org) antes de mutar.

import type { Tag } from "../types";
import type { CrmMutationContext } from "./context";

const DEFAULT_TAG_COLOR = "#6366f1";

export interface CreateTagInput {
  name: string;
  color?: string;
}

export type UpdateTagInput = Partial<CreateTagInput>;

/**
 * Cria uma tag no org. Throw em erro de DB ou unique violation.
 */
export async function createTag(
  ctx: CrmMutationContext,
  input: CreateTagInput,
): Promise<Tag> {
  const { db, orgId } = ctx;

  const { data, error } = await db
    .from("tags")
    .insert({
      organization_id: orgId,
      name: input.name,
      color: input.color || DEFAULT_TAG_COLOR,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Tag nao foi criada");
  return data as Tag;
}

/**
 * Atualiza uma tag. So altera campos passados. Org-scoping enforcado.
 * Throw se a tag nao pertence ao org.
 */
export async function updateTag(
  ctx: CrmMutationContext,
  tagId: string,
  input: UpdateTagInput,
): Promise<void> {
  const { db, orgId } = ctx;

  // Valida que a tag pertence ao org antes de update — defesa em
  // profundidade pra service-role que bypassa RLS.
  const { data: tag } = await db
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!tag) throw new Error("Tag nao encontrada nesta organizacao");

  const updateData: Record<string, string> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.color !== undefined) updateData.color = input.color;

  if (Object.keys(updateData).length === 0) return; // nada a fazer

  const { error } = await db
    .from("tags")
    .update(updateData)
    .eq("id", tagId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}

/**
 * Deleta uma tag. Remove primeiro todas as associacoes em lead_tags,
 * depois deleta a tag em si — evita FK violation.
 */
export async function deleteTag(
  ctx: CrmMutationContext,
  tagId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  // Valida org-scoping
  const { data: tag } = await db
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!tag) throw new Error("Tag nao encontrada nesta organizacao");

  // Remove associacoes primeiro (evita FK violation se nao tiver
  // ON DELETE CASCADE no schema)
  await db
    .from("lead_tags")
    .delete()
    .eq("tag_id", tagId)
    .eq("organization_id", orgId);

  const { error } = await db
    .from("tags")
    .delete()
    .eq("id", tagId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}

/**
 * Associa uma tag a um lead. Valida que ambos pertencem ao org.
 * Idempotente: ignora unique violation (23505) silenciosamente — se a
 * associacao ja existia, nao eh erro.
 */
export async function addTagToLead(
  ctx: CrmMutationContext,
  leadId: string,
  tagId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  const { data: lead } = await db
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!lead) throw new Error("Lead nao encontrado nesta organizacao");

  const { data: tag } = await db
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!tag) throw new Error("Tag nao encontrada nesta organizacao");

  const { error } = await db.from("lead_tags").insert({
    lead_id: leadId,
    tag_id: tagId,
    organization_id: orgId,
  });

  if (error) {
    if (error.code === "23505") {
      // Associacao ja existia — operacao idempotente, nao eh erro.
      return;
    }
    throw new Error(error.message);
  }

  ctx.onLeadChanged?.(leadId);
}

/**
 * Remove uma associacao tag→lead. Idempotente: nao throw se a
 * associacao nao existia.
 */
export async function removeTagFromLead(
  ctx: CrmMutationContext,
  leadId: string,
  tagId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  const { error } = await db
    .from("lead_tags")
    .delete()
    .eq("lead_id", leadId)
    .eq("tag_id", tagId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);

  ctx.onLeadChanged?.(leadId);
}
