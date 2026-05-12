// PR-S5: mutation pra encontrar ou criar conversa WhatsApp do lead.
// Usado pelo botao "Abrir conversa" no menu do LeadsList + drawer
// (futuro). Compartilhada entre CRM e admin — antes era SQL replicado.
//
// Estrategia:
//   1. Busca conversa aberta mais recente do lead (status active/
//      waiting_human). Se existe, retorna.
//   2. Senao, cria nova conversa atribuida a `actingUserId` (caller
//      passa — agente que clicou ou admin atuando).
//
// Multi-tenant: confirma lead pertence ao org antes de tudo.

import type { CrmQueryContext } from "../queries/context";

export interface FindOrCreateConversationResult {
  conversationId: string;
  created: boolean;
}

/**
 * Find ou create da conversa do lead.
 * `actingUserId` = quem fica como `assigned_to` na nova conversa.
 */
export async function findOrCreateConversationByLead(
  ctx: CrmQueryContext,
  leadId: string,
  actingUserId: string,
): Promise<FindOrCreateConversationResult> {
  const { db, orgId } = ctx;

  // Defesa multi-tenant: confirma lead pertence ao org do caller
  const { data: lead } = await db
    .from("leads")
    .select("id, channel")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) {
    throw new Error("Lead não encontrado nesta organização");
  }

  // Find: conversa aberta mais recente do lead
  const { data: existing } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .in("status", ["active", "waiting_human"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { conversationId: existing.id as string, created: false };
  }

  // Create: nova conversa atribuida ao actingUser
  const { data: created, error } = await db
    .from("conversations")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      channel: ((lead as { channel?: string }).channel as string) || "whatsapp",
      status: "active",
      assigned_to: actingUserId,
      last_message_at: null,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Erro ao criar conversa");
  }

  return { conversationId: created.id as string, created: true };
}
