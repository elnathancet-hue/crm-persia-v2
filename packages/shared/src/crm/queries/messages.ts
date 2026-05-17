// Queries puras pra `messages` (chat com lead).
//
// PR-AGENDA-LAST-MSG (mai/2026): primeira query desse modulo —
// `findLastMessageForLead`, usada pelo AppointmentDrawer pra mostrar
// contexto da ultima conversa direto no drawer sem o agente sair pro
// chat.
//
// Multi-tenant: `.eq("organization_id", orgId)` explicito.

import type { CrmQueryContext } from "./context";

export type LeadMessageDirection = "inbound" | "outbound";

export interface LeadLastMessagePreview {
  id: string;
  conversation_id: string;
  /** Pode vir vazio quando message e so media (image/audio/etc). */
  content: string | null;
  /** "inbound" = veio do lead. "outbound" = veio do CRM/agente/AI. */
  direction: LeadMessageDirection;
  /**
   * Texto cru do sender (lead / agent / ai / system / etc). Mantido pra
   * debug/observability, mas UI deve usar `direction` pra decidir
   * orientacao do bubble.
   */
  sender_raw: string;
  /** Tipo da mensagem: text, image, audio, video, document, etc. */
  type: string | null;
  created_at: string;
}

/**
 * Heuristica de direcao baseada no valor de `messages.sender`. Schema
 * nao tem coluna `direction` explicita — convencao do produto eh
 * "lead" = inbound, qualquer outro (user/agent/ai/system) = outbound.
 *
 * Mantido isolado pra testar facil + permitir tweak quando o time
 * formalizar direction como coluna real (migration futura).
 */
export function deriveDirection(sender: string): LeadMessageDirection {
  return sender === "lead" ? "inbound" : "outbound";
}

/**
 * Pega a ultima mensagem trocada com o lead (qualquer conversa, qualquer
 * direcao). Usado pelo AppointmentDrawer.
 *
 * Retorna `null` quando lead nunca trocou mensagem (esperado pra leads
 * frios que so estao no funil).
 *
 * Sort por `created_at DESC` — ultima primeiro. Limit 1.
 */
export async function findLastMessageForLead(
  ctx: CrmQueryContext,
  leadId: string,
): Promise<LeadLastMessagePreview | null> {
  const { db, orgId } = ctx;

  const { data, error } = await db
    .from("messages")
    .select("id, conversation_id, content, sender, type, created_at")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`findLastMessageForLead: ${error.message}`);
  }
  if (!data) return null;

  const row = data as {
    id: string;
    conversation_id: string;
    content: string | null;
    sender: string;
    type: string | null;
    created_at: string | null;
  };

  return {
    id: row.id,
    conversation_id: row.conversation_id,
    content: row.content,
    direction: deriveDirection(row.sender),
    sender_raw: row.sender,
    type: row.type,
    created_at: row.created_at ?? new Date().toISOString(),
  };
}
