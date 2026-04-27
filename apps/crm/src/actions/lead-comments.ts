"use server";

// Comentarios internos do time sobre um lead. Suporta o drawer
// "Informacoes do lead" tab Comentarios (Fase 4 da reformulacao do
// /crm).
//
// author_id eh nullable (ON DELETE SET NULL) — preserva o historico
// quando o usuario eh removido. Update/delete: so o autor (ou admin+)
// pode mexer (enforced por RLS na migration 031).
//
// Cast `untyped()` pra contornar Database type desatualizado — a
// tabela lead_comments eh nova (migration 031).

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { LeadCommentWithAuthor } from "@persia/shared/crm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function untyped(client: unknown): { from: (t: string) => any } {
  return client as { from: (t: string) => any };
}

const COMMENT_BODY_MAX = 5000;

export async function getLeadComments(
  leadId: string,
): Promise<LeadCommentWithAuthor[]> {
  const { supabase, orgId } = await requireRole("agent");
  const { data, error } = await untyped(supabase)
    .from("lead_comments")
    .select(
      "*, author:profiles!lead_comments_author_id_fkey(id, full_name)",
    )
    .eq("lead_id", leadId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as LeadCommentWithAuthor[];
}

export async function createLeadComment(input: {
  lead_id: string;
  body: string;
}): Promise<LeadCommentWithAuthor> {
  const { supabase, orgId, userId } = await requireRole("agent");
  const trimmed = input.body.trim();
  if (!trimmed) throw new Error("Comentario nao pode ser vazio");
  if (trimmed.length > COMMENT_BODY_MAX) {
    throw new Error(`Comentario excede ${COMMENT_BODY_MAX} caracteres`);
  }

  // Valida que o lead pertence ao org.
  const { data: lead } = await untyped(supabase)
    .from("leads")
    .select("id")
    .eq("id", input.lead_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) throw new Error("Lead nao encontrado nesta organizacao");

  const { data, error } = await untyped(supabase)
    .from("lead_comments")
    .insert({
      organization_id: orgId,
      lead_id: input.lead_id,
      author_id: userId,
      body: trimmed,
    })
    .select(
      "*, author:profiles!lead_comments_author_id_fkey(id, full_name)",
    )
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Falha ao criar comentario");
  revalidatePath(`/leads/${input.lead_id}`);
  revalidatePath("/crm");
  return data as LeadCommentWithAuthor;
}

export async function updateLeadComment(
  commentId: string,
  body: string,
): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comentario nao pode ser vazio");
  if (trimmed.length > COMMENT_BODY_MAX) {
    throw new Error(`Comentario excede ${COMMENT_BODY_MAX} caracteres`);
  }

  // RLS ja garante que so o autor (ou admin+) pode editar — aqui so
  // adiciona org-scoping defense-in-depth.
  const { error } = await untyped(supabase)
    .from("lead_comments")
    .update({ body: trimmed, updated_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath("/crm");
}

export async function deleteLeadComment(commentId: string): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  const { error } = await untyped(supabase)
    .from("lead_comments")
    .delete()
    .eq("id", commentId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath("/crm");
}
