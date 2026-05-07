"use server";

// PR-M: actions CRUD pra comentarios colaborativos no lead.
//
// Modelo: flat (sem threaded replies — Slack-style). Cada comentario
// e visivel pra TODOS membros da org (RLS migration 037). Apenas o
// autor pode editar/deletar (RLS).
//
// Multi-tenant em camadas: requireRole + organization_id check + RLS.
// Privacidade: agente so VE comentarios da propria org.

import { requireRole } from "@/lib/auth";
import { revalidateLeadCaches } from "@/lib/cache/lead-revalidation";

// Helper: tabela lead_comments e nova (migration 037) e ainda nao
// foi regenerada no Database type. Cast soft pra any pra permitir
// queries — RLS + CHECK constraints garantem integridade no DB.
// Pattern alinhado com outros lugares do projeto que usam `as never`
// em inserts em colunas JSON (memory).
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
 * Lista comentarios de um lead, ordenados cronologicamente
 * (mais antigo primeiro — leitura de conversa natural).
 *
 * Embed do nome do autor via JOIN com profiles (PR-L1 RLS permite
 * ler profiles de membros da mesma org). Se profile nao existe ou
 * RLS bloqueia, fallback "Autor desconhecido".
 *
 * Multi-tenant: lead lookup scoped por orgId, lead_comments tem
 * RLS proprio (membros da org leem).
 */
export async function getLeadComments(
  leadId: string,
): Promise<LeadComment[]> {
  const { supabase, orgId } = await requireRole("agent");

  // Defesa: confirma lead pertence ao org
  const { data: lead } = await supabase
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
    console.error("[getLeadComments] failed:", error);
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
 * Cria comentario num lead. Validacoes:
 *   - lead pertence ao org do caller
 *   - content min 1 char, max 2000 (CHECK constraint no DB tambem)
 *   - author_id sera auth.uid() via RLS WITH CHECK
 */
export async function createLeadComment(
  leadId: string,
  content: string,
): Promise<LeadComment> {
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new Error("Comentário não pode ser vazio");
  if (trimmed.length > 2000) throw new Error("Máximo 2000 caracteres");

  const { supabase, orgId, userId } = await requireRole("agent");

  // Defesa: lead da org
  const { data: lead } = await supabase
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

  // Buscar nome do autor (mesma org via PR-L1 RLS)
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  await revalidateLeadCaches(leadId);

  return {
    ...data,
    author_name: (profile?.full_name as string | null) ?? null,
  } as LeadComment;
}

/**
 * Atualiza conteudo de um comentario. RLS garante que so o autor
 * consegue (policy "Author updates own lead_comment").
 */
export async function updateLeadComment(
  commentId: string,
  content: string,
): Promise<{ success: boolean }> {
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new Error("Comentário não pode ser vazio");
  if (trimmed.length > 2000) throw new Error("Máximo 2000 caracteres");

  const { supabase, orgId } = await requireRole("agent");

  // Buscar lead_id pra revalidar (e validar org)
  const { data: existing } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .select("lead_id")
    .eq("id", commentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!existing) throw new Error("Comentário não encontrado");

  const { error } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .update({ content: trimmed })
    .eq("id", commentId);

  if (error) throw new Error(error.message);

  await revalidateLeadCaches(existing.lead_id as string);
  return { success: true };
}

/**
 * Deleta comentario. RLS garante que so o autor consegue.
 */
export async function deleteLeadComment(
  commentId: string,
): Promise<{ success: boolean }> {
  const { supabase, orgId } = await requireRole("agent");

  // Buscar lead_id pra revalidar
  const { data: existing } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .select("lead_id")
    .eq("id", commentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!existing) throw new Error("Comentário não encontrado");

  const { error } = await (supabase as unknown as LooseDb)
    .from("lead_comments")
    .delete()
    .eq("id", commentId);

  if (error) throw new Error(error.message);

  await revalidateLeadCaches(existing.lead_id as string);
  return { success: true };
}
