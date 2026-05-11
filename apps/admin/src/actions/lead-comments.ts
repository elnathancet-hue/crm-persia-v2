"use server";

// PR-S1: actions CRUD pra comentarios colaborativos no lead (admin side).
//
// Diferenca vs apps/crm:
//   - Auth: requireSuperadminForOrg() (le orgId do cookie assinado)
//     em vez de requireRole("agent")
//   - Supabase: admin (service_role) — bypassa RLS, mas mantemos check
//     manual de organization_id como defesa em camada
//   - author_id: setado como o admin userId quando admin escreve
//     (admin aparece como autor pros agentes do org)
//
// Modelo: mesmo do PR-M (flat, lead_comments table).

import { requireSuperadminForOrg } from "@/lib/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

// Helper: tabela lead_comments e nova (migration 037) e ainda nao
// foi regenerada no Database type. Cast soft pra permitir queries —
// pattern alinhado com outros usos no admin.
type LooseDb = { from: (table: string) => any };

export interface LeadComment {
  id: string;
  lead_id: string;
  organization_id: string;
  author_id: string;
  author_name: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

/**
 * Lista comentarios de um lead, ordenados cronologicamente.
 * Admin so ve comentarios do org que esta gerenciando (cookie scope).
 */
export async function getLeadComments(
  leadId: string,
): Promise<LeadComment[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Defesa em camada: confirma lead pertence ao org do cookie
  const { data: lead } = await (supabase as unknown as LooseDb)
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) return [];

  const { data, error } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .select(
      "id, lead_id, organization_id, author_id, content, created_at, updated_at, profiles!lead_comments_author_id_fkey(full_name)",
    )
    .eq("lead_id", leadId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[admin getLeadComments] failed:", error);
    return [];
  }

  type Row = {
    id: string;
    lead_id: string;
    organization_id: string;
    author_id: string;
    content: string;
    created_at: string;
    updated_at: string;
    profiles: { full_name: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    lead_id: row.lead_id,
    organization_id: row.organization_id,
    author_id: row.author_id,
    author_name: row.profiles?.full_name ?? null,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Cria comentario num lead (admin atuando em nome do org gerenciado).
 * author_id = userId do admin logado.
 */
export async function createLeadComment(
  leadId: string,
  content: string,
): Promise<LeadComment> {
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new Error("Comentário não pode ser vazio");
  if (trimmed.length > 2000) throw new Error("Máximo 2000 caracteres");

  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Defesa: lead pertence ao org
  const { data: lead } = await (supabase as unknown as LooseDb)
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) throw new Error("Lead não encontrado nesta organização");

  const { data, error } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      author_id: userId,
      content: trimmed,
    })
    .select(
      "id, lead_id, organization_id, author_id, content, created_at, updated_at",
    )
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Comentário não foi criado");

  // Busca nome do autor (admin)
  const { data: profile } = await (supabase as unknown as LooseDb)
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  return {
    ...data,
    author_name: (profile?.full_name as string | null) ?? null,
  } as LeadComment;
}

/**
 * Atualiza conteudo de um comentario.
 * Admin (service_role) bypassa RLS — pode editar QUALQUER comentario.
 * Defesa: checa organization_id antes pra evitar cross-org accidental.
 */
export async function updateLeadComment(
  commentId: string,
  content: string,
): Promise<{ success: boolean }> {
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new Error("Comentário não pode ser vazio");
  if (trimmed.length > 2000) throw new Error("Máximo 2000 caracteres");

  const { admin, orgId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  // Confirma que o comentario pertence ao org gerenciado
  const { data: existing } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .select("lead_id, organization_id")
    .eq("id", commentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!existing) throw new Error("Comentário não encontrado");

  const { error } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .update({ content: trimmed })
    .eq("id", commentId);

  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * Deleta comentario.
 * Admin (service_role) pode deletar qualquer comentario do org gerenciado.
 */
export async function deleteLeadComment(
  commentId: string,
): Promise<{ success: boolean }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const supabase = admin as unknown as SupabaseClient;

  const { data: existing } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .select("lead_id, organization_id")
    .eq("id", commentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!existing) throw new Error("Comentário não encontrado");

  const { error } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .delete()
    .eq("id", commentId);

  if (error) throw new Error(error.message);
  return { success: true };
}
