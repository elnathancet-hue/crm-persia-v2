"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { revalidateLeadAndChatCaches } from "@/lib/cache/lead-revalidation";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadCampaignMedia, type MediaUploadResult } from "@/lib/campaigns/media-upload";
import { createProvider } from "@/lib/whatsapp/providers";
import {
  addTagToLead as addTagToLeadShared,
  bulkMoveLeads as bulkMoveLeadsShared,
} from "@persia/shared/crm";

type RoleSupabase = Awaited<ReturnType<typeof requireRole>>["supabase"];

async function setNativeAgentHandoffForConversation(
  supabase: RoleSupabase,
  orgId: string,
  conversationId: string,
  paused: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  const patch = paused
    ? {
        human_handoff_at: now,
        human_handoff_reason: "human_takeover",
        updated_at: now,
      }
    : {
        human_handoff_at: null,
        human_handoff_reason: null,
        updated_at: now,
      };

  const { error } = await supabase
    .from("agent_conversations")
    .update(patch)
    .eq("organization_id", orgId)
    .eq("crm_conversation_id", conversationId);

  if (error) {
    console.error("[assignConversation] native handoff sync failed:", error);
  }

  const { data: rows, error: epochLoadError } = await supabase
    .from("agent_conversations")
    .select("id, ai_control_epoch")
    .eq("organization_id", orgId)
    .eq("crm_conversation_id", conversationId);

  if (epochLoadError) {
    console.error("[assignConversation] epoch load failed:", epochLoadError);
    return;
  }

  for (const row of rows ?? []) {
    const current = (row as { ai_control_epoch?: number | null }).ai_control_epoch ?? 0;
    const { error: epochUpdateError } = await supabase
      .from("agent_conversations")
      .update({
        ai_control_epoch: current + 1,
        updated_at: now,
      })
      .eq("organization_id", orgId)
      .eq("id", (row as { id: string }).id);

    if (epochUpdateError) {
      console.error("[assignConversation] epoch bump failed:", epochUpdateError);
    }
  }
}

export type ConversationFilter = "all" | "ai" | "waiting_human";

export type ConversationWithLead = {
  id: string;
  organization_id: string;
  lead_id: string;
  channel: string;
  status: string;
  assigned_to: string;
  queue_id: string | null;
  ai_summary: string | null;
  unread_count: number;
  last_message_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  leads: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    channel: string;
    lead_tags?: Array<{
      tag_id: string;
      tags: { id: string; name: string; color: string | null } | null;
    }>;
  };
  last_message?: {
    content: string | null;
    sender: string;
    created_at: string;
  } | null;
};

export async function getConversations(
  orgId: string,
  options: { filter?: ConversationFilter; search?: string } = {}
) {
  // Agent read — orgId param is validated against caller's org below
  const { supabase, orgId: callerOrgId, userId, permissions } = await requireRole("agent");
  if (orgId !== callerOrgId) return { data: null, error: "Org mismatch" };

  const { filter = "all", search } = options;

  let query = supabase
    .from("conversations")
    .select(`
      *,
      leads!inner (
        id,
        name,
        phone,
        email,
        avatar_url,
        channel,
        lead_tags (
          tag_id,
          tags ( id, name, color )
        )
      )
    `)
    .eq("organization_id", orgId)
    .neq("status", "closed")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  // Módulo C: escopo por own_only
  // Conversas legadas têm assigned_to = "ai" — incluímos para não mostrar tela vazia
  if (permissions?.chat?.own_only) {
    query = query.or(`assigned_to.eq.${userId},assigned_to.eq.ai`);
  }

  if (filter === "ai") {
    query = query.eq("assigned_to", "ai");
  } else if (filter === "waiting_human") {
    // Só mostra conversas onde o lead ainda aguarda resposta (unread > 0).
    // Conversas já respondidas ficam com unread_count = 0 e saem do filtro.
    query = query.eq("status", "waiting_human").gt("unread_count", 0);
  }

  if (search) {
    // Sanitize to prevent PostgREST filter injection via special chars
    const sanitized = search.replace(/[%_,()\\]/g, "").trim();
    if (sanitized) {
      const [matchingLeadsResult, matchingMessagesResult] = await Promise.all([
        supabase
          .from("leads")
          .select("id")
          .eq("organization_id", orgId)
          .or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`),
        supabase
          .from("messages")
          .select("conversation_id")
          .eq("organization_id", orgId)
          .textSearch("content", sanitized, {
            config: "portuguese",
            type: "websearch",
          })
          .limit(200),
      ]);

      if (matchingLeadsResult.error) {
        console.error("Error searching leads:", matchingLeadsResult.error);
      }
      if (matchingMessagesResult.error) {
        console.error("Error searching messages:", matchingMessagesResult.error);
      }

      const leadIds = (matchingLeadsResult.data || []).map((l) => l.id);
      const conversationIds = Array.from(
        new Set((matchingMessagesResult.data || []).map((m) => m.conversation_id).filter(Boolean))
      );

      if (leadIds.length === 0 && conversationIds.length === 0) return { data: [], error: null };
      if (leadIds.length > 0 && conversationIds.length > 0) {
        query = query.or(`lead_id.in.(${leadIds.join(",")}),id.in.(${conversationIds.join(",")})`);
      } else if (leadIds.length > 0) {
        query = query.in("lead_id", leadIds);
      } else {
        query = query.in("id", conversationIds);
      }
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching conversations:", error);
    return { data: null, error: error.message };
  }

  const conversationIds = (data || []).map((c: any) => c.id);

  if (conversationIds.length > 0) {
    const { data: messages } = await supabase
      .from("messages")
      .select("conversation_id, content, sender, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false });

    const lastMessages = new Map<string, any>();
    if (messages) {
      for (const msg of messages) {
        if (!lastMessages.has(msg.conversation_id)) {
          lastMessages.set(msg.conversation_id, msg);
        }
      }
    }

    const enriched = (data || []).map((conv: any) => ({
      ...conv,
      last_message: lastMessages.get(conv.id) || null,
    }));

    return { data: enriched as ConversationWithLead[], error: null };
  }

  return { data: (data || []) as ConversationWithLead[], error: null };
}

export async function getConversation(id: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("conversations")
    .select(`
      *,
      leads (
        id,
        name,
        phone,
        email,
        avatar_url,
        channel,
        source,
        status,
        score,
        metadata,
        website,
        notes,
        address_country,
        address_state,
        address_city,
        address_zip,
        address_street,
        address_number,
        address_neighborhood,
        address_complement,
        created_at,
        updated_at,
        assigned_to,
        lead_tags (
          tag_id,
          tags ( id, name, color )
        )
      )
    `)
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) {
    console.error("Error fetching conversation:", error);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

/**
 * PR-C: find-or-create conversation by lead. Usado pelo botao
 * "Abrir conversa" do card Kanban — quando o agente clica num lead
 * sem conversa ativa, queremos abrir uma conversa interna em vez de
 * deixar ele no `wa.me/` externo.
 *
 * Reusa a logica do `incoming-pipeline.ts` (find by lead + status
 * em ["active", "waiting_human"], senao cria nova). Diferenca: aqui
 * a nova conversa nasce ja atribuida ao agente que clicou (`user.id`)
 * em vez de "ai" — porque o agente quer responder pessoalmente.
 *
 * Retorna { conversationId, created } pra o caller decidir se mostra
 * toast "Conversa criada" ou apenas navega.
 */
export async function findOrCreateConversationByLead(
  leadId: string,
): Promise<{ conversationId: string; created: boolean }> {
  // PR-S5: logica em packages/shared/src/crm/mutations/conversations.ts.
  // Aqui so wrappa auth + revalidate (Next-specific).
  const { supabase, orgId, userId } = await requireRole("agent");
  const { findOrCreateConversationByLead: findOrCreateShared } =
    await import("@persia/shared/crm");
  const result = await findOrCreateShared(
    { db: supabase, orgId },
    leadId,
    userId,
  );

  // PR-K LEAD-SYNC: nova conversa criada por agente -> /chat e
  // /leads atualizam (drawer mostra conversation count via PR-D
  // header rico, lista pode mostrar "ultima conversa" futuramente).
  if (result.created) {
    await revalidateLeadAndChatCaches(leadId);
  }
  return result;
}

export async function assignConversation(
  conversationId: string,
  assignTo: string
) {
  const { supabase, orgId } = await requireRole("agent");

  const isAi = assignTo === "ai";

  const { data: conv } = await supabase
    .from("conversations")
    .select("organization_id, lead_id, leads(phone)")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (!conv) return { data: null, error: "Conversa nao encontrada" };

  const { data, error } = await supabase
    .from("conversations")
    .update({
      assigned_to: assignTo,
      status: isAi ? "active" : "waiting_human",
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) {
    console.error("Error assigning conversation:", error);
    return { data: null, error: error.message };
  }

  await setNativeAgentHandoffForConversation(
    supabase,
    orgId,
    conversationId,
    !isAi,
  );

  if (conv?.organization_id && (conv.leads as any)?.phone) {
    const phone = (conv.leads as any).phone as string;

    import("@/lib/whatsapp/sync").then(({ disableChatbotForLead, enableChatbotForLead, syncTicketStatusToUazapi }) => {
      if (!isAi) {
        disableChatbotForLead(orgId, phone, 480);
        syncTicketStatusToUazapi(orgId, phone, true, assignTo);
      } else {
        enableChatbotForLead(orgId, phone);
        syncTicketStatusToUazapi(orgId, phone, true);
      }
    }).catch((err) => {
      console.error("[assignConversation] sync error:", err);
    });
  }

  revalidatePath("/chat");
  return { data, error: null };
}

export async function closeConversation(conversationId: string) {
  // Fix mai/2026: alem do close da conversation, agora:
  //   1. Limpa `agent_conversations.human_handoff_at` pra que a IA reative
  //      automaticamente no proximo contato do lead (nova conversation
  //      sera criada via webhook quando lead mandar nova msg).
  //   2. Insere lead_activities com type='conversation_closed' pra audit
  //      no historico do lead.
  // Action ja existia (cobre sync UAZAPI + ai_summary placeholder) — esses
  // 2 passos foram adicionados pra fechar o gap de "fechar e reativar".
  const { supabase, orgId, userId } = await requireRole("agent");

  const { data: conv } = await supabase
    .from("conversations")
    .select("organization_id, lead_id, leads(phone)")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (!conv) return { data: null, error: "Conversa nao encontrada" };

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("conversations")
    .update({
      status: "closed",
      closed_at: now,
      ai_summary: "Resumo gerado automaticamente ao encerrar a conversa.",
      updated_at: now,
    })
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) {
    console.error("Error closing conversation:", error);
    return { data: null, error: error.message };
  }

  // Passo 1: limpa handoff do native agent (paused=false libera IA).
  // Best-effort: se nao existir agent_conversations linkada (org legacy
  // que usa pipeline n8n), helper vira no-op silencioso.
  await setNativeAgentHandoffForConversation(supabase, orgId, conversationId, false);

  // Passo 2: log no historico do lead. Best-effort — falha aqui nao
  // bloqueia o close.
  if (conv.lead_id) {
    const { error: activityError } = await supabase
      .from("lead_activities")
      .insert({
        organization_id: orgId,
        lead_id: conv.lead_id,
        performed_by: userId,
        type: "conversation_closed",
        description: "Conversa encerrada manualmente.",
        metadata: {
          source: "chat_ui",
          conversation_id: conversationId,
        },
        created_at: now,
      });
    if (activityError) {
      console.error("[closeConversation] activity log failed:", activityError.message);
    }
  }

  if ((conv.leads as { phone?: string } | null)?.phone) {
    const phone = (conv.leads as { phone: string }).phone;

    import("@/lib/whatsapp/sync").then(({ enableChatbotForLead, syncTicketStatusToUazapi }) => {
      enableChatbotForLead(orgId, phone);
      syncTicketStatusToUazapi(orgId, phone, false);
    }).catch((err) => {
      console.error("[closeConversation] sync error:", err);
    });
  }

  revalidatePath("/chat");
  if (conv.lead_id) {
    revalidatePath(`/leads/${conv.lead_id}`);
  }
  return { data, error: null };
}

export async function markConversationAsRead(conversationId: string) {
  const { supabase, orgId } = await requireRole("agent");

  const [, convResult] = await Promise.all([
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .eq("organization_id", orgId),
    supabase
      .from("conversations")
      .select("channel, leads(phone)")
      .eq("id", conversationId)
      .eq("organization_id", orgId)
      .single(),
  ]);

  const conv = convResult.data;
  const phone = (conv?.leads as { phone?: string } | null)?.phone;
  if (phone && conv?.channel === "whatsapp") {
    void (async () => {
      try {
        const { data: connection } = await supabase
          .from("whatsapp_connections")
          .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
          .eq("organization_id", orgId)
          .eq("status", "connected")
          .limit(1)
          .single();
        if (connection) await createProvider(connection).markChatRead(phone);
      } catch { /* fire-and-forget */ }
    })();
  }
}

async function getLeadIdsForConversations(
  supabase: RoleSupabase,
  orgId: string,
  conversationIds: string[],
): Promise<string[]> {
  const ids = [...new Set(conversationIds.filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("conversations")
    .select("lead_id")
    .eq("organization_id", orgId)
    .in("id", ids);

  if (error) throw new Error(error.message);
  return [
    ...new Set(
      (data ?? [])
        .map((row: { lead_id: string | null }) => row.lead_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

export async function bulkMarkConversationsAsRead(
  conversationIds: string[],
): Promise<{ updated_count: number }> {
  const { supabase, orgId } = await requireRole("agent");
  const ids = [...new Set(conversationIds.filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return { updated_count: 0 };

  const [updateResult, conversationsResult] = await Promise.all([
    supabase
      .from("conversations")
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .in("id", ids)
      .select("id"),
    supabase
      .from("conversations")
      .select("channel, leads(phone)")
      .eq("organization_id", orgId)
      .in("id", ids),
  ]);

  if (updateResult.error) throw new Error(updateResult.error.message);

  const phones = (conversationsResult.data ?? [])
    .filter((conversation: any) => conversation.channel === "whatsapp")
    .map((conversation: any) => conversation.leads?.phone)
    .filter((phone: unknown): phone is string => typeof phone === "string" && phone.trim().length > 0);

  if (phones.length > 0) {
    void (async () => {
      try {
        const { data: connection } = await supabase
          .from("whatsapp_connections")
          .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
          .eq("organization_id", orgId)
          .eq("status", "connected")
          .limit(1)
          .single();
        if (!connection) return;
        const provider = createProvider(connection);
        await Promise.all([...new Set(phones)].map((phone) => provider.markChatRead(phone)));
      } catch {
        // Best-effort: o contador local ja foi zerado.
      }
    })();
  }

  revalidatePath("/chat");
  return { updated_count: updateResult.data?.length ?? 0 };
}

export async function bulkMoveConversationLeads(
  conversationIds: string[],
  stageId: string,
): Promise<{ updated_count: number }> {
  const { supabase, orgId } = await requireRole("agent");
  const leadIds = await getLeadIdsForConversations(supabase, orgId, conversationIds);
  if (leadIds.length === 0) return { updated_count: 0 };

  const result = await bulkMoveLeadsShared({ db: supabase, orgId }, leadIds, stageId);
  revalidatePath("/chat");
  revalidatePath("/crm");
  return result;
}

export async function bulkApplyTagToConversationLeads(
  conversationIds: string[],
  tagId: string,
): Promise<{ updated_count: number }> {
  const { supabase, orgId } = await requireRole("agent");
  const leadIds = await getLeadIdsForConversations(supabase, orgId, conversationIds);
  if (leadIds.length === 0) return { updated_count: 0 };

  for (const leadId of leadIds) {
    await addTagToLeadShared({ db: supabase, orgId }, leadId, tagId);
  }

  revalidatePath("/chat");
  revalidatePath("/crm");
  revalidatePath("/leads");
  return { updated_count: leadIds.length };
}

export async function generateConversationSummary(conversationId: string): Promise<{ summary: string; error?: string }> {
  const { supabase, orgId } = await requireRole("agent");

  // Verify conversation belongs to caller's org
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();
  if (!conv) return { summary: "", error: "Conversa nao encontrada" };

  const { data: messages } = await supabase
    .from("messages")
    .select("sender, content, created_at")
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(30);

  if (!messages || messages.length === 0) {
    return { summary: "", error: "Sem mensagens para resumir" };
  }

  const transcript = messages
    .map((m) => {
      const who = m.sender === "lead" ? "Lead" : m.sender === "ai" ? "IA" : "Agente";
      return `${who}: ${m.content || "[midia]"}`;
    })
    .join("\n");

  try {
    const { chatCompletion } = await import("@/lib/ai/openai");
    const summary = await chatCompletion(
      "Voce e um assistente que resume conversas de atendimento. Faca um resumo conciso em portugues da conversa abaixo. Inclua: assunto principal, pedidos do lead, status atual. Maximo 3 paragrafos curtos.",
      [{ role: "user", content: transcript }],
      { model: "gpt-4.1-mini", temperature: 0.3, maxTokens: 500 }
    );

    await supabase
      .from("conversations")
      .update({ ai_summary: summary })
      .eq("id", conversationId)
      .eq("organization_id", orgId);

    return { summary };
  } catch (err: unknown) {
    return { summary: "", error: err instanceof Error ? err.message : "Erro ao gerar resumo" };
  }
}

export async function generateAgentResponse(
  conversationId: string,
  agentQuestion: string,
  assistantId?: string
): Promise<{ suggestion: string; error?: string }> {
  const { supabase, orgId } = await requireRole("agent");

  const { data: conv } = await supabase
    .from("conversations")
    .select("organization_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (!conv) return { suggestion: "", error: "Conversa nao encontrada" };

  let assistant: { prompt: string; tone: string | null } | null = null;
  if (assistantId) {
    const { data } = await supabase
      .from("ai_assistants")
      .select("prompt, tone")
      .eq("id", assistantId)
      .eq("organization_id", orgId)
      .single();
    assistant = data;
  } else {
    const { data } = await supabase
      .from("ai_assistants")
      .select("prompt, tone")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .limit(1)
      .single();
    assistant = data;
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("sender, content")
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(15);

  const context = (messages || [])
    .reverse()
    .map((m) => {
      const who = m.sender === "lead" ? "Lead" : m.sender === "ai" ? "IA" : "Agente";
      return `${who}: ${m.content || "[midia]"}`;
    })
    .join("\n");

  const systemPrompt = `Voce e um assistente que ajuda agentes de atendimento a responder clientes.
${assistant?.prompt ? `Contexto da empresa: ${assistant.prompt}` : ""}
Tom: ${assistant?.tone || "amigavel"}

O agente precisa de ajuda para responder. Gere uma sugestao de resposta baseada no contexto da conversa e na pergunta do agente.
Retorne APENAS a mensagem sugerida, sem explicacoes. A mensagem deve ser natural como se fosse digitada no WhatsApp.`;

  try {
    const { chatCompletion } = await import("@/lib/ai/openai");
    const suggestion = await chatCompletion(
      systemPrompt,
      [
        { role: "user", content: `Contexto da conversa:\n${context}\n\nPergunta do agente: ${agentQuestion}` },
      ],
      { model: "gpt-4.1-mini", temperature: 0.7, maxTokens: 500 }
    );

    return { suggestion };
  } catch (err: unknown) {
    return { suggestion: "", error: err instanceof Error ? err.message : "Erro ao gerar sugestao" };
  }
}

export async function scheduleMessage(
  conversationId: string,
  content: string,
  scheduledAt: string,
  type: string = "text",
  media?: {
    media_type: "none" | "image" | "video" | "audio" | "document";
    media_url: string;
    media_filename?: string | null;
    media_mime_type?: string | null;
    media_size?: number | null;
  } | null,
) {
  const { supabase, orgId, userId } = await requireRole("agent");
  const trimmed = content.trim();

  const { data: conv } = await supabase
    .from("conversations")
    .select("organization_id, lead_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (!conv) throw new Error("Conversa nao encontrada");
  if (!trimmed && !media?.media_url) {
    throw new Error("Informe uma mensagem ou anexe uma midia");
  }

  const scheduledRow = {
    organization_id: orgId,
    conversation_id: conversationId,
    lead_id: conv.lead_id,
    content: trimmed || null,
    type: media?.media_type && media.media_type !== "none" ? media.media_type : type,
    media_type: media?.media_type ?? "none",
    media_url: media?.media_url ?? null,
    media_filename: media?.media_filename ?? null,
    media_mime_type: media?.media_mime_type ?? null,
    media_size: media?.media_size ?? null,
    scheduled_at: scheduledAt,
    created_by: userId,
    status: "pending",
  };

  const { data, error } = await supabase
    .from("scheduled_messages")
    .insert(scheduledRow as never)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function uploadScheduledMessageMediaAction(
  formData: FormData,
): Promise<{ data?: MediaUploadResult; error?: string }> {
  try {
    const { orgId } = await requireRole("agent");
    const file = formData.get("file");
    if (!(file instanceof File)) return { error: "Arquivo nao enviado" };

    const admin = createAdminClient();
    const { data: buckets } = await admin.storage.listBuckets();
    if (!buckets?.some((bucket) => bucket.name === "campaign-media")) {
      await admin.storage.createBucket("campaign-media", { public: true });
    }

    const result = await uploadCampaignMedia(admin, {
      file,
      orgId,
      campaignId: `scheduled-${crypto.randomUUID()}`,
    });

    if ("error" in result) return { error: result.error };
    return { data: result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Nao foi possivel enviar a midia" };
  }
}

// ---------------------------------------------------------------------------
// Módulo A-5 — Distribuição manual por fila
// ---------------------------------------------------------------------------

export async function getActiveQueues() {
  const { supabase, orgId } = await requireRole("agent");
  const { data, error } = await supabase
    .from("queues")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function transferConversationToQueue(
  conversationId: string,
  queueId: string,
) {
  const { supabase, orgId } = await requireRole("agent");

  const { data: agentId, error: rpcError } = await supabase.rpc(
    "pick_agent_from_queue",
    { p_org_id: orgId, p_queue_id: queueId },
  );

  if (rpcError) throw new Error(rpcError.message);
  if (!agentId) throw new Error("Fila sem agentes disponíveis");

  const { error: updateError } = await supabase
    .from("conversations")
    .update({
      assigned_to: agentId,
      queue_id: queueId,
      status: "waiting_human",
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("organization_id", orgId);

  if (updateError) throw new Error(updateError.message);

  await supabase.from("queue_distribution_log").insert({
    organization_id: orgId,
    queue_id: queueId,
    assigned_to: agentId,
    conversation_id: conversationId,
  });

  revalidatePath("/chat");
  return { agentId };
}
