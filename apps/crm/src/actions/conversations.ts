"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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
  const { supabase, orgId: callerOrgId } = await requireRole("agent");
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
        channel
      )
    `)
    .eq("organization_id", orgId)
    .neq("status", "closed")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (filter === "ai") {
    query = query.eq("assigned_to", "ai");
  } else if (filter === "waiting_human") {
    query = query.eq("status", "waiting_human");
  }

  if (search) {
    // Sanitize to prevent PostgREST filter injection via special chars
    const sanitized = search.replace(/[%_,()\\]/g, "").trim();
    if (sanitized) {
      const { data: matchingLeads } = await supabase
        .from("leads")
        .select("id")
        .eq("organization_id", orgId)
        .or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`);
      const leadIds = (matchingLeads || []).map((l) => l.id);
      if (leadIds.length === 0) return { data: [], error: null };
      query = query.in("lead_id", leadIds);
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
        created_at
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
  const { supabase, orgId, userId } = await requireRole("agent");

  // Defesa multi-tenant: confirma que o lead pertence a org do caller
  const { data: lead } = await supabase
    .from("leads")
    .select("id, channel")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!lead) {
    throw new Error("Lead não encontrado nesta organização");
  }

  // Find: conversa aberta mais recente do lead
  const { data: existing } = await supabase
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

  // Create: nova conversa atribuida ao agente que clicou
  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      channel: (lead.channel as string) || "whatsapp",
      status: "active",
      assigned_to: userId,
      last_message_at: null,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Erro ao criar conversa");
  }

  revalidatePath("/chat");
  return { conversationId: created.id as string, created: true };
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
      status: isAi ? "ai_handling" : "human_handling",
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
  const { supabase, orgId } = await requireRole("agent");

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

  if ((conv.leads as any)?.phone) {
    const phone = (conv.leads as any).phone as string;

    import("@/lib/whatsapp/sync").then(({ enableChatbotForLead, syncTicketStatusToUazapi }) => {
      enableChatbotForLead(orgId, phone);
      syncTicketStatusToUazapi(orgId, phone, false);
    }).catch((err) => {
      console.error("[closeConversation] sync error:", err);
    });
  }

  revalidatePath("/chat");
  return { data, error: null };
}

export async function markConversationAsRead(conversationId: string) {
  const { supabase, orgId } = await requireRole("agent");

  await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId)
    .eq("organization_id", orgId);
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
  type: string = "text"
) {
  const { supabase, orgId, userId } = await requireRole("agent");

  const { data: conv } = await supabase
    .from("conversations")
    .select("organization_id, lead_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (!conv) throw new Error("Conversa nao encontrada");

  const { data, error } = await supabase
    .from("scheduled_messages")
    .insert({
      organization_id: orgId,
      conversation_id: conversationId,
      lead_id: conv.lead_id,
      content,
      type,
      scheduled_at: scheduledAt,
      created_by: userId,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
