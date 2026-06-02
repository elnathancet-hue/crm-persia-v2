// stop-on-reply.ts — para campanha quando lead/grupo responde.
//
// Chamado pelo incoming-pipeline (chat 1x1) e pelo handler de grupos.
// Para grupos: stop-on-reply desabilitado no MVP (comentário no roadmap §6).
//
// Fluxo:
//   1. Identifica recipients ativos em campanhas scheduled/running
//      vinculados ao lead ou conversa
//   2. Atualiza last_response_at
//   3. Se campanha ou step tem stop_on_reply, marca recipient como stopped
//      e cancela jobs futuros daquele recipient
//   4. Grava evento reply_detected

import type { SupabaseClient } from "@supabase/supabase-js";

interface StopOnReplyInput {
  supabase: SupabaseClient;
  orgId: string;
  leadId?: string | null;
  conversationId?: string | null;
  groupId?: string | null;
  isGroup?: boolean;
}

export async function handleInboundReplyForCampaigns(
  input: StopOnReplyInput,
): Promise<void> {
  const { supabase, orgId, leadId, conversationId, groupId, isGroup } = input;

  // Para grupos: MVP não implementa stop-on-reply
  if (isGroup) return;

  if (!leadId && !conversationId) return;

  try {
    // Busca recipients ativos em campanhas que ainda estão rodando
    let recipientsQuery = supabase
      .from("crm_campaign_recipients")
      .select("id, campaign_id, status, lead_id, conversation_id")
      .eq("organization_id", orgId)
      .eq("status", "active");

    if (leadId) {
      recipientsQuery = recipientsQuery.eq("lead_id", leadId) as typeof recipientsQuery;
    } else if (conversationId) {
      recipientsQuery = recipientsQuery.eq("conversation_id", conversationId) as typeof recipientsQuery;
    }

    const { data: recipients, error } = await recipientsQuery;
    if (error || !recipients?.length) return;

    const now = new Date().toISOString();

    for (const recipient of recipients as Array<{ id: string; campaign_id: string; status: string }>) {
      // Atualiza last_response_at
      await supabase
        .from("crm_campaign_recipients")
        .update({ last_response_at: now } as never)
        .eq("id", recipient.id);

      // Verifica se campanha tem stop_on_reply
      const { data: campaign } = await supabase
        .from("crm_campaigns")
        .select("id, status, stop_on_reply")
        .eq("id", recipient.campaign_id)
        .eq("organization_id", orgId)
        .maybeSingle();

      if (!campaign) continue;

      const c = campaign as { id: string; status: string; stop_on_reply: boolean };
      if (c.status !== "scheduled" && c.status !== "running") continue;

      if (!c.stop_on_reply) continue;

      // Parar este recipient
      await supabase
        .from("crm_campaign_recipients")
        .update({ status: "stopped" } as never)
        .eq("id", recipient.id);

      // Cancelar jobs futuros do recipient
      await supabase
        .from("crm_campaign_message_jobs")
        .update({ status: "cancelled" } as never)
        .eq("recipient_id", recipient.id)
        .eq("status", "queued");

      // Evento
      await supabase
        .from("crm_campaign_events")
        .insert({
          organization_id: orgId,
          campaign_id: recipient.campaign_id,
          recipient_id: recipient.id,
          event_type: "reply_detected",
          payload: {
            lead_id: leadId ?? null,
            conversation_id: conversationId ?? null,
            stopped_at: now,
          },
        } as never);
    }
  } catch {
    // best-effort — falha no stop-on-reply nunca pode bloquear o chat
  }
}
