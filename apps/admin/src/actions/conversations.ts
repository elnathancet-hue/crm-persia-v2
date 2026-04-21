"use server";

import { requireSuperadminForOrg } from "@/lib/auth";


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
  options: { filter?: ConversationFilter; search?: string } = {}
) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { filter = "all", search } = options;

  let query = admin
    .from("conversations")
    .select(`id, organization_id, lead_id, channel, status, assigned_to, queue_id, ai_summary, unread_count, last_message_at, closed_at, created_at, updated_at, leads!inner (id, name, phone, email, avatar_url, channel)`)
    .eq("organization_id", orgId)
    .neq("status", "closed")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (filter === "ai") query = query.eq("assigned_to", "ai");
  else if (filter === "waiting_human") query = query.eq("status", "waiting_human");

  if (search) {
    const sanitized = search.replace(/[%_,()]/g, "");
    query = query.or(
      `leads.name.ilike.%${sanitized}%,leads.phone.ilike.%${sanitized}%`,
      { referencedTable: "leads" }
    );
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };

  // Fetch last message per conversation (limit to avoid fetching thousands)
  const ids = (data || []).map((c) => c.id);
  if (ids.length > 0) {
    const { data: messages } = await admin
      .from("messages")
      .select("conversation_id, content, sender, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(ids.length * 3);

    const lastMessages = new Map<string, { content: string | null; sender: string; created_at: string }>();
    if (messages) {
      for (const msg of messages) {
        if (!lastMessages.has(msg.conversation_id)) {
          lastMessages.set(msg.conversation_id, msg);
        }
      }
    }

    for (const conv of data!) {
      (conv as any).last_message = lastMessages.get(conv.id) || null;
    }
  }

  return { data: data as ConversationWithLead[], error: null };
}

export async function getConversation(conversationId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin
    .from("conversations")
    .select(`*, leads (id, name, phone, email, avatar_url, channel)`)
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function assignConversation(conversationId: string, assignTo: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("conversations")
    .update({
      assigned_to: assignTo,
      status: assignTo === "ai" ? "active" : "assigned",
      updated_at: now,
    })
    .eq("id", conversationId)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  return { error: null };
}

export async function closeConversation(conversationId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("conversations")
    .update({ status: "closed", closed_at: now, updated_at: now })
    .eq("id", conversationId)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  return { error: null };
}

export async function markConversationAsRead(conversationId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin
    .from("conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  return { error: null };
}

export async function reopenConversation(conversationId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin
    .from("conversations")
    .update({ status: "active", closed_at: null, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  return { error: null };
}

export async function getClosedConversations() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin
    .from("conversations")
    .select(`*, leads!inner (id, name, phone, email, avatar_url, channel)`)
    .eq("organization_id", orgId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(50);
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function getActiveAssistants() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin
    .from("ai_assistants")
    .select("id, name, category, prompt, tone")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("created_at");
  return data || [];
}

export async function generateAgentResponse(
  conversationId: string,
  agentQuestion: string,
  assistantId?: string
): Promise<{ suggestion: string; error?: string }> {
  const { admin, orgId } = await requireSuperadminForOrg();

  // Validate conversation belongs to active org
  const { data: conv } = await admin
    .from("conversations")
    .select("organization_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (!conv) return { suggestion: "", error: "Conversa nao encontrada nesta organizacao" };

  let assistant: { prompt: string; tone: string } | null = null;
  if (assistantId) {
    // Validate assistant belongs to the same org
    const { data } = await admin
      .from("ai_assistants")
      .select("prompt, tone")
      .eq("id", assistantId)
      .eq("organization_id", orgId)
      .single();
    assistant = data;
  } else {
    const { data } = await admin
      .from("ai_assistants")
      .select("prompt, tone")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .limit(1)
      .single();
    assistant = data;
  }

  const { data: messages } = await admin
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
      [{ role: "user", content: `Contexto da conversa:\n${context}\n\nPergunta do agente: ${agentQuestion}` }],
      { model: "gpt-4.1-mini", temperature: 0.7, maxTokens: 500 }
    );
    return { suggestion };
  } catch (e: unknown) {
    return { suggestion: "", error: e instanceof Error ? e.message : "Erro ao gerar sugestao" };
  }
}
