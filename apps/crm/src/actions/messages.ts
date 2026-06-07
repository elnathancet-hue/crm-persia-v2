"use server";

import { requireRole } from "@/lib/auth";
import { auditFailure, auditLog } from "@/lib/audit";
import {
  findLastMessageForLead as findLastMessageForLeadShared,
  type LeadLastMessagePreview,
} from "@persia/shared/crm";
import { normalizeHumanizationConfig } from "@persia/shared/ai-agent";
import {
  CHAT_MEDIA_BUCKET,
  createChatMediaPath,
  ensureChatMediaBucket,
  resolveChatMediaUrl,
  resolveProviderChatMediaUrl,
  toChatMediaRef,
  withSignedChatMediaUrls,
} from "@/lib/chat-media";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorMessage, logError } from "@/lib/observability";
import { createProvider } from "@/lib/whatsapp/providers";
import { UazapiClient } from "@persia/shared";

export type Message = {
  id: string;
  conversation_id: string;
  organization_id: string;
  lead_id: string;
  sender: string;
  sender_user_id: string | null;
  content: string | null;
  type: string;
  media_url: string | null;
  media_type: string | null;
  whatsapp_msg_id: string | null;
  status: string;
  metadata: unknown;
  is_pinned?: boolean;
  created_at: string;
  /** UI-only: true while media is being uploaded (not persisted) */
  _optimistic?: boolean;
  /** UI-only: local object URL for preview while uploading */
  _localPreview?: string | null;
};

type ReplySnapshot = {
  id: string;
  whatsapp_msg_id: string | null;
  sender: string;
  content: string | null;
  type: string | null;
  media_type: string | null;
};

function getMessageFileName(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const fileName = (metadata as Record<string, unknown>).file_name;
  return typeof fileName === "string" && fileName ? fileName : undefined;
}

async function getReplySnapshot(
  supabase: Awaited<ReturnType<typeof requireRole>>["supabase"],
  orgId: string,
  conversationId: string,
  replyToMessageId?: string,
): Promise<ReplySnapshot | null> {
  if (!replyToMessageId) return null;

  const { data, error } = await supabase
    .from("messages")
    .select("id, whatsapp_msg_id, sender, content, type, media_type")
    .eq("id", replyToMessageId)
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    whatsapp_msg_id: data.whatsapp_msg_id ?? null,
    sender: data.sender ?? "lead",
    content: data.content ?? null,
    type: data.type ?? null,
    media_type: data.media_type ?? null,
  };
}

// PR-AI-AGENT-HUMAN-A: auto-pause native AI quando humano (operator)
// responde manualmente pelo CRM. Seta human_handoff_at na agent_conversation
// quando a humanization_config DAQUELE agent_config tem auto_pause_minutes > 0.
// Toda chamada e best-effort — falha aqui nao bloqueia envio da msg humana.
// Idempotente: usa NULL guard no UPDATE pra so pausar conversas ativas
// (nao reseta timer se ja pausada).
//
// PR-4 Auditoria (mai/2026): endereca rodada 7 #alta #2. Antes, este
// helper carregava humanization do "primeiro agent_config ativo da org"
// (ORDER BY created_at, LIMIT 1), nao do agente que atende a conversa.
// Em orgs multi-agent (routing condicional), isso podia silenciosamente
// desligar auto-pause quando o agente "mais antigo" tinha
// auto_pause_minutes=0. Agora cada agent_conversations e avaliada com
// a config do SEU proprio config_id via JOIN.
async function autoPauseNativeAgent(
  supabase: Awaited<ReturnType<typeof requireRole>>["supabase"],
  orgId: string,
  conversationId: string,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    // JOIN agent_conversations × agent_configs pra avaliar humanization
    // por linha. Supabase PostgREST embed: nested `agent_configs!inner`
    // garante que rows com config_id orfa nao retornam (defensive).
    const { data: agentConversations, error: loadError } = await supabase
      .from("agent_conversations")
      .select(
        "id, config_id, human_handoff_at, ai_control_epoch, agent_configs!inner(humanization_config)",
      )
      .eq("organization_id", orgId)
      .eq("crm_conversation_id", conversationId);

    if (loadError) throw loadError;

    for (const row of agentConversations ?? []) {
      const typedRow = row as {
        id: string;
        config_id: string;
        human_handoff_at?: string | null;
        ai_control_epoch?: number | null;
        agent_configs?:
          | { humanization_config?: unknown }
          | Array<{ humanization_config?: unknown }>;
      };
      // Postgrest pode retornar embed como objeto OU array dependendo do schema.
      const configRow = Array.isArray(typedRow.agent_configs)
        ? typedRow.agent_configs[0]
        : typedRow.agent_configs;
      const humanization = normalizeHumanizationConfig(
        configRow?.humanization_config,
      );
      // auto_pause_minutes=0 desliga a feature pra ESSE agente especifico.
      if (humanization.auto_pause_minutes <= 0) continue;
      // ja pausada — preserva o timer original.
      if (typedRow.human_handoff_at) continue;

      const currentEpoch = typedRow.ai_control_epoch ?? 0;
      await supabase
        .from("agent_conversations")
        .update({
          human_handoff_at: now,
          human_handoff_reason: "operator_reply",
          ai_control_epoch: currentEpoch + 1,
          updated_at: now,
        })
        .eq("organization_id", orgId)
        .eq("id", typedRow.id);
    }
  } catch (err: unknown) {
    logError("auto_pause_native_agent_failed", {
      organization_id: orgId,
      conversation_id: conversationId,
      error: errorMessage(err),
    });
  }
}

async function markConversationHumanOwnedAfterOperatorReply(
  supabase: Awaited<ReturnType<typeof requireRole>>["supabase"],
  orgId: string,
  conversationId: string,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("conversations")
    .update({
      assigned_to: userId,
      status: "waiting_human",
      updated_at: now,
    })
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .eq("assigned_to", "ai");

  if (error) {
    logError("mark_conversation_human_owned_after_operator_reply_failed", {
      organization_id: orgId,
      conversation_id: conversationId,
      error: errorMessage(error),
    });
  }
}

export async function getMessages(
  conversationId: string,
  options: { limit?: number; before?: string } = {}
) {
  const { supabase, orgId } = await requireRole("agent");
  const { limit = 50, before } = options;

  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching messages:", error);
    return { data: null, error: error.message };
  }

  // Return in chronological order
  const sorted = (data || []).reverse();
  const admin = createAdminClient();
  const signedMessages = await withSignedChatMediaUrls(admin, sorted as Message[]);

  return { data: signedMessages, error: null };
}

export async function resolveMessageMediaUrl(
  messageId: string
): Promise<{ url: string | null; error?: string }> {
  const { orgId } = await requireRole("agent");
  const admin = createAdminClient();
  const { data: message, error } = await admin
    .from("messages")
    .select("id, media_url")
    .eq("id", messageId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) return { url: null, error: error.message };
  if (!message?.media_url) return { url: null };

  return { url: await resolveChatMediaUrl(admin, message.media_url) };
}

export async function sendMessage(
  conversationId: string,
  payload: { content: string; type?: string; mediaUrl?: string }
) {
  const { supabase, orgId, userId } = await requireRole("agent");

  // Get conversation to know lead_id and organization_id
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("lead_id, organization_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (convError || !conversation) {
    return { data: null, error: "Conversa nao encontrada" };
  }

  const now = new Date().toISOString();

  // Insert message
  const { data: message, error: msgError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      organization_id: conversation.organization_id,
      lead_id: conversation.lead_id,
      sender: "agent",
      sender_user_id: userId,
      content: payload.content,
      type: payload.type || "text",
      media_url: payload.mediaUrl || null,
      status: "sent",
    })
    .select()
    .single();

  if (msgError) {
    console.error("Error sending message:", msgError);
    return { data: null, error: msgError.message };
  }

  // Update conversation last_message_at and reset unread
  await supabase
    .from("conversations")
    .update({
      last_message_at: now,
      unread_count: 0,
      updated_at: now,
    })
    .eq("id", conversationId);

  await autoPauseNativeAgent(supabase, conversation.organization_id, conversationId);
  await markConversationHumanOwnedAfterOperatorReply(
    supabase,
    conversation.organization_id,
    conversationId,
    userId,
  );

  return { data: message as Message, error: null };
}

/**
 * Envia mensagem pelo agente e tambem via WhatsApp usando o provider.
 * 1. Salva mensagem no DB (sender: "agent")
 * 2. Envia via WhatsApp usando o provider configurado
 * 3. Retorna a mensagem salva
 */
export async function sendMessageViaWhatsApp(
  conversationId: string,
  content: string,
  options?: { replyToWhatsAppMsgId?: string; replyToMessageId?: string }
): Promise<{ data?: Message; error?: string }> {
  const { supabase, orgId, userId } = await requireRole("agent");

  // 2. Get conversation + lead phone
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select(
      `
      id,
      lead_id,
      organization_id,
      channel,
      leads (
        id,
        phone
      )
    `
    )
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (convError || !conversation) {
    return { error: "Conversa nao encontrada" };
  }

  const lead = (conversation as Record<string, unknown>).leads as Record<string, unknown> | null;
  const phone = lead?.phone as string | null;

  // 3. Save message to DB with status='sending'
  const now = new Date().toISOString();
  const replySnapshot = await getReplySnapshot(
    supabase,
    orgId,
    conversationId,
    options?.replyToMessageId,
  );

  const { data: message, error: msgError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      organization_id: conversation.organization_id,
      lead_id: conversation.lead_id,
      sender: "agent",
      sender_user_id: userId,
      content,
      type: "text",
      metadata: replySnapshot ? { reply_to: replySnapshot } : {},
      status: "sending",
    })
    .select()
    .single();

  if (msgError) {
    console.error("Error saving message:", msgError);
    return { error: msgError.message };
  }

  // Update conversation last_message_at and reset unread
  await supabase
    .from("conversations")
    .update({
      last_message_at: now,
      unread_count: 0,
      updated_at: now,
    })
    .eq("id", conversationId);

  // PR-AI-AGENT-HUMAN-A: humano respondeu via /chat → pausa agente
  // nativo (best-effort). Nao bloqueia envio se falhar.
  await autoPauseNativeAgent(supabase, conversation.organization_id, conversationId);
  await markConversationHumanOwnedAfterOperatorReply(
    supabase,
    conversation.organization_id,
    conversationId,
    userId,
  );

  // 4. Send via WhatsApp, propagating errors to the UI
  if (phone && conversation.channel === "whatsapp") {
    const { data: connection } = await supabase
      .from("whatsapp_connections")
      .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("organization_id", conversation.organization_id)
      .eq("status", "connected")
      .limit(1)
      .single();

    if (!connection) {
      await supabase.from("messages").update({ status: "failed" }).eq("id", message.id);
      await auditFailure({
        userId,
        orgId,
        action: "crm_send_message",
        entityType: "message",
        entityId: message.id,
        metadata: { conversation_id: conversationId, channel: conversation.channel, stage: "missing_connection" },
        error: new Error("Nenhuma conexao WhatsApp ativa"),
      });
      return { data: { ...(message as Message), status: "failed" }, error: "Nenhuma conexao WhatsApp ativa" };
    }

    try {
      const provider = createProvider(connection);
      const replyTo = options?.replyToWhatsAppMsgId ?? replySnapshot?.whatsapp_msg_id ?? undefined;
      const result = await provider.sendText({
        phone,
        message: content,
        ...(replyTo ? { replyTo } : {}),
      });
      const update: Record<string, unknown> = { status: "sent" };
      if (result.messageId) update.whatsapp_msg_id = result.messageId;
      await supabase.from("messages").update(update as never).eq("id", message.id);
      await auditLog({
        userId,
        orgId,
        action: "crm_send_message",
        entityType: "message",
        entityId: message.id,
        metadata: { conversation_id: conversationId, channel: conversation.channel, provider: connection.provider },
      });
      return { data: { ...(message as Message), status: "sent", whatsapp_msg_id: result.messageId ?? null } };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Falha ao enviar ao WhatsApp";
      await supabase.from("messages").update({ status: "failed" }).eq("id", message.id);
      await auditFailure({
        userId,
        orgId,
        action: "crm_send_message",
        entityType: "message",
        entityId: message.id,
        metadata: { conversation_id: conversationId, channel: conversation.channel, stage: "provider_send" },
        error: err,
      });
      return { data: { ...(message as Message), status: "failed" }, error: reason };
    }
  }

  // Not a WhatsApp channel: still mark as sent
  await supabase.from("messages").update({ status: "sent" }).eq("id", message.id);
  await auditLog({
    userId,
    orgId,
    action: "crm_send_message",
    entityType: "message",
    entityId: message.id,
    metadata: { conversation_id: conversationId, channel: conversation.channel },
  });
  return { data: { ...(message as Message), status: "sent" } };
}

export async function getConversationMediaFiles(
  conversationId: string,
): Promise<{ id: string; type: string; media_url: string | null; content: string | null; created_at: string }[]> {
  const { supabase, orgId } = await requireRole("agent");
  const { data } = await supabase
    .from("messages")
    .select("id, type, media_url, content, created_at")
    .eq("organization_id", orgId)
    .eq("conversation_id", conversationId)
    .in("type", ["image", "video", "document", "audio", "ptt"])
    .not("media_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((m) => ({
    id: m.id,
    type: m.type ?? "unknown",
    media_url: m.media_url,
    content: m.content,
    created_at: m.created_at ?? "",
  }));
}

export async function forwardMessagesToConversations(
  messageIds: string[],
  targetConversationIds: string[],
): Promise<{ sent_count: number; skipped_count: number; error?: string }> {
  const { supabase, orgId } = await requireRole("agent");

  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean).slice(0, 10);
  const uniqueTargetIds = [...new Set(targetConversationIds)].filter(Boolean).slice(0, 20);

  if (uniqueMessageIds.length === 0) return { sent_count: 0, skipped_count: 0, error: "Selecione pelo menos uma mensagem" };
  if (uniqueTargetIds.length === 0) return { sent_count: 0, skipped_count: 0, error: "Selecione pelo menos uma conversa" };

  const { data: sourceMessages, error: sourceError } = await supabase
    .from("messages")
    .select("id, content, type, status, created_at")
    .eq("organization_id", orgId)
    .in("id", uniqueMessageIds)
    .order("created_at", { ascending: true });

  if (sourceError) return { sent_count: 0, skipped_count: 0, error: sourceError.message };

  const forwardableMessages = (sourceMessages ?? []).filter(
    (message) =>
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      message.status !== "deleted",
  );

  if (forwardableMessages.length === 0) {
    return {
      sent_count: 0,
      skipped_count: uniqueMessageIds.length,
      error: "Nenhuma mensagem de texto selecionada para encaminhar",
    };
  }

  const { data: targetConversations, error: targetError } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .in("id", uniqueTargetIds);

  if (targetError) return { sent_count: 0, skipped_count: 0, error: targetError.message };

  const allowedTargetIds = new Set((targetConversations ?? []).map((conversation) => conversation.id));
  let sentCount = 0;
  let skippedCount = uniqueMessageIds.length - forwardableMessages.length;

  for (const targetId of uniqueTargetIds) {
    if (!allowedTargetIds.has(targetId)) {
      skippedCount += forwardableMessages.length;
      continue;
    }

    for (const message of forwardableMessages) {
      const result = await sendMessageViaWhatsApp(targetId, message.content!.trim());
      if (result.error) skippedCount += 1;
      else sentCount += 1;
    }
  }

  return { sent_count: sentCount, skipped_count: skippedCount };
}

/**
 * Envia midia (imagem, audio, video, documento) via WhatsApp.
 * 1. Salva a midia no bucket privado chat-media
 * 2. Salva mensagem no DB com ref interna (chat-media:path)
 * 3. Envia via provider usando signed URL temporaria
 * 3. Retorna a mensagem salva
 */
export async function sendMediaViaWhatsApp(
  formData: FormData
): Promise<{ data?: Message; error?: string }> {
  let mediaPath: string | null = null;
  let admin: ReturnType<typeof createAdminClient> | undefined;
  try {
  const { supabase, orgId, userId } = await requireRole("agent");

  const conversationId = formData.get("conversationId") as string;
  const fileObj = formData.get("file") as File | null;
  const mediaType = formData.get("type") as "image" | "audio" | "video" | "document" | "ptt";
  const caption = (formData.get("caption") as string | null) || undefined;
  const replyToWhatsAppMsgId = (formData.get("replyToWhatsAppMsgId") as string | null) || undefined;
  const replyToMessageId = (formData.get("replyToMessageId") as string | null) || undefined;

  if (!conversationId || !fileObj || !mediaType) return { error: "Dados incompletos" };

  const fileName = fileObj.name || `${mediaType}-${Date.now()}`;
  const mimeType = fileObj.type || "application/octet-stream";
  const buffer = Buffer.from(await fileObj.arrayBuffer());
  if (buffer.byteLength > 16 * 1024 * 1024) {
    return { error: "Arquivo maior que 16MB" };
  }

  // 2. Get conversation + lead phone
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select(
      `
      id,
      lead_id,
      organization_id,
      channel,
      leads (
        id,
        phone
      )
    `
    )
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (convError || !conversation) {
    return { error: "Conversa nao encontrada" };
  }

  const lead = (conversation as Record<string, unknown>).leads as Record<string, unknown> | null;
  const phone = lead?.phone as string | null;

  admin = createAdminClient();
  await ensureChatMediaBucket(admin);
  mediaPath = createChatMediaPath({ orgId, conversationId, fileName });
  const { error: uploadError } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(mediaPath, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    await auditFailure({
      userId,
      orgId,
      action: "crm_send_media",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { stage: "upload", media_type: mediaType, mime_type: mimeType, bytes: buffer.byteLength },
      error: uploadError,
    });
    return { error: uploadError.message };
  }

  const mediaRef = toChatMediaRef(mediaPath);

  // 3. Save message to DB with status='sending'
  const now = new Date().toISOString();
  const replySnapshot = await getReplySnapshot(
    supabase,
    orgId,
    conversationId,
    replyToMessageId,
  );

  const { data: message, error: msgError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      organization_id: conversation.organization_id,
      lead_id: conversation.lead_id,
      sender: "agent",
      sender_user_id: userId,
      content: caption || null,
      type: mediaType,
      media_url: mediaRef,
      media_type: mimeType,
      metadata: {
        file_name: fileName,
        mime_type: mimeType,
        ...(replySnapshot ? { reply_to: replySnapshot } : {}),
      },
      status: "sending",
    })
    .select()
    .single();

  if (msgError) {
    await admin.storage.from(CHAT_MEDIA_BUCKET).remove([mediaPath]).catch(() => {});
    console.error("Error saving media message:", msgError);
    await auditFailure({
      userId,
      orgId,
      action: "crm_send_media",
      entityType: "conversation",
      entityId: conversationId,
      metadata: { stage: "save_message", media_type: mediaType, mime_type: mimeType, bytes: buffer.byteLength },
      error: msgError,
    });
    return { error: msgError.message };
  }

  await supabase
    .from("conversations")
    .update({ last_message_at: now, unread_count: 0, updated_at: now })
    .eq("id", conversationId);

  // PR-AI-AGENT-HUMAN-A: humano enviou midia via /chat → pausa agente
  // nativo (best-effort). Paridade com sendMessageViaWhatsApp.
  await autoPauseNativeAgent(supabase, conversation.organization_id, conversationId);
  await markConversationHumanOwnedAfterOperatorReply(
    supabase,
    conversation.organization_id,
    conversationId,
    userId,
  );

  // 4. Send via WhatsApp, propagating errors
  if (phone && conversation.channel === "whatsapp") {
    const { data: connection } = await supabase
      .from("whatsapp_connections")
      .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("organization_id", conversation.organization_id)
      .eq("status", "connected")
      .limit(1)
      .single();

    if (!connection) {
      await supabase.from("messages").update({ status: "failed" }).eq("id", message.id);
      const signedMediaUrl = await resolveChatMediaUrl(admin, mediaRef);
      await auditFailure({
        userId,
        orgId,
        action: "crm_send_media",
        entityType: "message",
        entityId: message.id,
        metadata: { conversation_id: conversationId, media_type: mediaType, stage: "missing_connection" },
        error: new Error("Nenhuma conexao WhatsApp ativa"),
      });
      return { data: { ...(message as Message), media_url: signedMediaUrl, status: "failed" }, error: "Nenhuma conexao WhatsApp ativa" };
    }

    try {
      const provider = createProvider(connection);
      const providerMediaUrl = await resolveProviderChatMediaUrl(admin, mediaRef);
      const replyTo = replyToWhatsAppMsgId ?? replySnapshot?.whatsapp_msg_id ?? undefined;
      const result = await provider.sendMedia({
        phone,
        type: mediaType,
        media: providerMediaUrl,
        caption: caption,
        fileName: mediaType === "document" ? fileName : undefined,
        ...(replyTo ? { replyTo } : {}),
      });
      const update: Record<string, unknown> = { status: "sent" };
      if (result.messageId) update.whatsapp_msg_id = result.messageId;
      await supabase.from("messages").update(update as never).eq("id", message.id);
      const signedMediaUrl = await resolveChatMediaUrl(admin, mediaRef);
      await auditLog({
        userId,
        orgId,
        action: "crm_send_media",
        entityType: "message",
        entityId: message.id,
        metadata: { conversation_id: conversationId, media_type: mediaType, provider: connection.provider },
      });
      return { data: { ...(message as Message), media_url: signedMediaUrl, status: "sent", whatsapp_msg_id: result.messageId ?? null } };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Falha ao enviar midia ao WhatsApp";
      await supabase.from("messages").update({ status: "failed" }).eq("id", message.id);
      const signedMediaUrl = await resolveChatMediaUrl(admin, mediaRef);
      await auditFailure({
        userId,
        orgId,
        action: "crm_send_media",
        entityType: "message",
        entityId: message.id,
        metadata: { conversation_id: conversationId, media_type: mediaType, stage: "provider_send" },
        error: err,
      });
      return { data: { ...(message as Message), media_url: signedMediaUrl, status: "failed" }, error: reason };
    }
  }

  await supabase.from("messages").update({ status: "sent" }).eq("id", message.id);
  const signedMediaUrl = await resolveChatMediaUrl(admin, mediaRef);
  await auditLog({
    userId,
    orgId,
    action: "crm_send_media",
    entityType: "message",
    entityId: message.id,
    metadata: { conversation_id: conversationId, media_type: mediaType, channel: conversation.channel },
  });
  return { data: { ...(message as Message), media_url: signedMediaUrl, status: "sent" } };
  } catch (err) {
    if (mediaPath && admin) {
      await admin.storage.from(CHAT_MEDIA_BUCKET).remove([mediaPath]).catch(() => {});
    }
    console.error("[sendMediaViaWhatsApp] error:", err instanceof Error ? err.message : String(err));
    return { error: err instanceof Error ? err.message : "Erro ao enviar midia" };
  }
}

/**
 * Retry sending a previously failed message.
 */
export async function resendMessage(
  messageId: string
): Promise<{ data?: Message; error?: string }> {
  const { supabase, orgId, userId } = await requireRole("agent");

  const { data: message, error: fetchError } = await supabase
    .from("messages")
    .select("*, conversations!inner (id, channel, leads (id, phone))")
    .eq("id", messageId)
    .eq("organization_id", orgId)
    .single();

  if (fetchError || !message) return { error: "Mensagem nao encontrada" };
  if (message.status !== "failed") return { error: "Mensagem nao esta em estado de falha" };

  const conv = (message as Record<string, unknown>).conversations as Record<string, unknown> | null;
  const lead = conv?.leads as Record<string, unknown> | null;
  const phone = lead?.phone as string | null;
  const channel = conv?.channel as string | null;

  if (!phone || channel !== "whatsapp") {
    return { error: "Conversa sem destinatario WhatsApp valido" };
  }

  await supabase.from("messages").update({ status: "sending" }).eq("id", messageId);

  const { data: connection } = await supabase
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();

  if (!connection) {
    const { data: updated } = await supabase.from("messages").update({ status: "failed" }).eq("id", messageId).select().single();
    const admin = createAdminClient();
    const signed = await withSignedChatMediaUrls(admin, [updated as Message]);
    await auditFailure({
      userId,
      orgId,
      action: "crm_resend_message",
      entityType: "message",
      entityId: messageId,
      metadata: { conversation_id: message.conversation_id, message_type: message.type, stage: "missing_connection" },
      error: new Error("Nenhuma conexao WhatsApp ativa"),
    });
    return { data: signed[0], error: "Nenhuma conexao WhatsApp ativa" };
  }

  try {
    const provider = createProvider(connection);
    let result;
    if (message.type === "text") {
      result = await provider.sendText({ phone, message: message.content || "" });
    } else if (message.type && ["image", "audio", "video", "document"].includes(message.type)) {
      if (!message.media_url) throw new Error("Media ausente para reenvio");
      const admin = createAdminClient();
      const mediaUrl = await resolveProviderChatMediaUrl(admin, message.media_url);
      result = await provider.sendMedia({
        phone,
        type: message.type as "image" | "audio" | "video" | "document",
        media: mediaUrl,
        caption: message.content || undefined,
        fileName: message.type === "document" ? getMessageFileName(message.metadata) : undefined,
      });
    } else {
      throw new Error(`Tipo de mensagem nao suportado para reenvio: ${message.type}`);
    }

    const update: Record<string, unknown> = { status: "sent" };
    if (result.messageId) update.whatsapp_msg_id = result.messageId;
    const { data: updated } = await supabase.from("messages").update(update as never).eq("id", messageId).select().single();
    const admin = createAdminClient();
    const signed = await withSignedChatMediaUrls(admin, [updated as Message]);
    await auditLog({
      userId,
      orgId,
      action: "crm_resend_message",
      entityType: "message",
      entityId: messageId,
      metadata: { conversation_id: message.conversation_id, message_type: message.type, provider: connection.provider },
    });
    return { data: signed[0] };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Falha ao reenviar";
    const { data: updated } = await supabase.from("messages").update({ status: "failed" }).eq("id", messageId).select().single();
    const admin = createAdminClient();
    const signed = await withSignedChatMediaUrls(admin, [updated as Message]);
    await auditFailure({
      userId,
      orgId,
      action: "crm_resend_message",
      entityType: "message",
      entityId: messageId,
      metadata: { conversation_id: message.conversation_id, message_type: message.type, stage: "provider_send" },
      error: err,
    });
    return { data: signed[0], error: reason };
  }
}

/**
 * PR-AGENDA-LAST-MSG (mai/2026): ultima mensagem do lead pro
 * AppointmentDrawer. requireRole("agent") + delega pro shared query.
 *
 * Multi-tenant garantido pelo shared (.eq organization_id, orgId) +
 * RLS de messages.
 */
export async function getLeadLastMessage(
  leadId: string,
): Promise<LeadLastMessagePreview | null> {
  const { supabase, orgId } = await requireRole("agent");
  return findLastMessageForLeadShared({ db: supabase, orgId }, leadId);
}

type SupabaseClient = Awaited<ReturnType<typeof requireRole>>["supabase"];

async function getWhatsAppContextForMessage(
  supabase: SupabaseClient,
  orgId: string,
  messageId: string,
) {
  const { data: msg } = await supabase
    .from("messages")
    .select("id, sender, whatsapp_msg_id, conversations(channel, leads(phone))")
    .eq("id", messageId)
    .eq("organization_id", orgId)
    .single();
  if (!msg || !msg.whatsapp_msg_id) return null;
  const conv = msg.conversations as Record<string, unknown> | null;
  if (!conv || conv.channel !== "whatsapp") return null;
  const lead = conv.leads as Record<string, unknown> | null;
  const phone = lead?.phone as string | null;
  if (!phone) return null;
  const { data: connection } = await supabase
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();
  if (!connection) return null;
  return { msg, phone, connection };
}

export async function editWhatsAppMessage(
  messageId: string,
  newText: string,
): Promise<{ error?: string }> {
  const { supabase, orgId } = await requireRole("agent");

  const ctx = await getWhatsAppContextForMessage(supabase, orgId, messageId);
  if (!ctx) return { error: "Mensagem não encontrada ou WhatsApp não configurado" };

  const { msg, phone, connection } = ctx;
  if (msg.sender !== "agent" && msg.sender !== "ai") {
    return { error: "Só é possível editar mensagens enviadas pelo agente" };
  }

  try {
    await createProvider(connection).editMessage(phone, msg.whatsapp_msg_id!, newText);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro ao editar mensagem no WhatsApp" };
  }

  // Persist content + edited_at timestamp in metadata so UI can show "Editada"
  const { data: currentMsg } = await supabase
    .from("messages")
    .select("metadata")
    .eq("id", messageId)
    .eq("organization_id", orgId)
    .single();
  const currentMeta = (currentMsg?.metadata as Record<string, unknown>) ?? {};
  await supabase
    .from("messages")
    .update({ content: newText, metadata: { ...currentMeta, edited_at: new Date().toISOString() } })
    .eq("id", messageId)
    .eq("organization_id", orgId);

  return {};
}

export async function reactToWhatsAppMessage(
  messageId: string,
  emoji: string,
): Promise<{ error?: string }> {
  const { supabase, orgId } = await requireRole("agent");

  const ctx = await getWhatsAppContextForMessage(supabase, orgId, messageId);
  if (!ctx) return { error: "Mensagem não encontrada ou WhatsApp não configurado" };

  const { msg, phone, connection } = ctx;

  try {
    await createProvider(connection).reactToMessage(phone, msg.whatsapp_msg_id!, emoji);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro ao reagir à mensagem" };
  }

  // Persist reaction in message metadata so it survives page reload
  const { data: currentMsg } = await supabase
    .from("messages")
    .select("metadata")
    .eq("id", messageId)
    .eq("organization_id", orgId)
    .single();
  const currentMeta = (currentMsg?.metadata as Record<string, unknown>) ?? {};
  const existing = Array.isArray(currentMeta.reactions)
    ? (currentMeta.reactions as Array<{ emoji: string; by: string }>)
    : [];
  await supabase
    .from("messages")
    .update({
      metadata: {
        ...currentMeta,
        // Replace any existing agent reaction for this message
        reactions: [...existing.filter((r) => r.by !== "agent"), { emoji, by: "agent" }],
      },
    })
    .eq("id", messageId)
    .eq("organization_id", orgId);

  return {};
}

export async function deleteWhatsAppMessage(messageId: string): Promise<{ error?: string }> {
  const { supabase, orgId } = await requireRole("agent");

  const ctx = await getWhatsAppContextForMessage(supabase, orgId, messageId);
  if (!ctx) return { error: "Mensagem não encontrada ou WhatsApp não configurado" };

  const { msg, phone, connection } = ctx;

  try {
    await createProvider(connection).deleteMessage(phone, msg.whatsapp_msg_id!);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro ao apagar mensagem" };
  }

  await supabase
    .from("messages")
    .update({ content: null, status: "deleted" })
    .eq("id", messageId)
    .eq("organization_id", orgId);

  return {};
}

// Hide message locally (no WhatsApp API call — "Apagar para mim" only)
export async function hideMessage(messageId: string): Promise<{ error?: string }> {
  const { supabase, orgId } = await requireRole("agent");
  await supabase
    .from("messages")
    .update({ content: null, status: "deleted" })
    .eq("id", messageId)
    .eq("organization_id", orgId);
  return {};
}

/**
 * Fixa ou desafixa uma mensagem no WhatsApp via UAZAPI.
 * Funciona em 1:1 e grupos. UAZAPI-only (Meta Cloud nao suporta).
 */
export async function pinWhatsAppMessage(
  messageId: string,
  pin = true,
  duration: 1 | 7 | 30 = 7,
): Promise<{ error?: string }> {
  const { supabase, orgId } = await requireRole("agent");

  const { data: msg } = await supabase
    .from("messages")
    .select("whatsapp_msg_id, conversation_id, conversations(channel, organization_id)")
    .eq("id", messageId)
    .eq("organization_id", orgId)
    .single();

  if (!msg?.whatsapp_msg_id) return { error: "Mensagem sem ID WhatsApp" };

  const conv = msg.conversations as Record<string, unknown> | null;
  if (!conv || conv.channel !== "whatsapp") return { error: "Conversa nao e WhatsApp" };

  const { data: connection } = await supabase
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();

  if (!connection || connection.provider !== "uazapi" || !connection.instance_url || !connection.instance_token) {
    return { error: "Fixar mensagem requer conexao UAZAPI ativa" };
  }

  try {
    const client = new UazapiClient({ baseUrl: connection.instance_url, token: connection.instance_token });
    await client.pinMessage(msg.whatsapp_msg_id, pin, duration);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro ao fixar mensagem" };
  }

  // Persist pin state locally so the banner can read it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  if (pin) {
    // Unpin any previously pinned message in this conversation first
    await db
      .from("messages")
      .update({ is_pinned: false })
      .eq("conversation_id", msg.conversation_id)
      .eq("organization_id", orgId);
  }
  await db
    .from("messages")
    .update({ is_pinned: pin })
    .eq("id", messageId)
    .eq("organization_id", orgId);

  return {};
}

export type AdvancedMessagePayload =
  | { type: "location"; data: { latitude: number; longitude: number; name?: string } }
  | { type: "contact"; data: { fullName: string; phoneNumber: string } }
  | { type: "pix"; data: { pixKey: string; pixName?: string; pixType: "CPF" | "CNPJ" | "PHONE" | "EMAIL" | "EVP" } }
  | { type: "payment"; data: { amount: number; pixKey: string } }
  | { type: "location_button"; data: { text: string } };

/**
 * Envia uma mensagem interativa (Location, Contact, Pix, Payment, LocationButton)
 */
export async function sendAdvancedMessageViaWhatsApp(
  conversationId: string,
  payload: AdvancedMessagePayload
): Promise<{ data?: Message; error?: string }> {
  const { supabase, orgId, userId } = await requireRole("agent");

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select(`
      id, lead_id, organization_id, channel, leads ( id, phone )
    `)
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (convError || !conversation) return { error: "Conversa não encontrada" };

  const lead = (conversation as Record<string, unknown>).leads as Record<string, unknown> | null;
  const phone = lead?.phone as string | null;

  const now = new Date().toISOString();

  // Save to DB first with 'sending' status
  const { data: message, error: msgError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      organization_id: conversation.organization_id,
      lead_id: conversation.lead_id,
      sender: "agent",
      sender_user_id: userId,
      type: payload.type,
      metadata: payload.data,
      status: "sending",
    })
    .select()
    .single();

  if (msgError) {
    return { error: msgError.message };
  }

  await supabase
    .from("conversations")
    .update({ last_message_at: now, unread_count: 0, updated_at: now })
    .eq("id", conversationId);

  await autoPauseNativeAgent(supabase, conversation.organization_id, conversationId);

  if (phone && conversation.channel === "whatsapp") {
    const { data: connection } = await supabase
      .from("whatsapp_connections")
      .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("organization_id", conversation.organization_id)
      .eq("status", "connected")
      .limit(1)
      .single();

    if (!connection) {
      await supabase.from("messages").update({ status: "failed" }).eq("id", message.id);
      return { data: { ...(message as Message), status: "failed" }, error: "Nenhuma conexão WhatsApp ativa" };
    }

    try {
      const provider = createProvider(connection);
      let result;

      switch (payload.type) {
        case "location":
          result = await provider.sendLocation({ phone, ...payload.data });
          break;
        case "contact":
          result = await provider.sendContact({ phone, ...payload.data });
          break;
        case "pix":
          result = await provider.sendPix({ phone, ...payload.data });
          break;
        case "payment":
          result = await provider.sendPaymentRequest({ phone, ...payload.data });
          break;
        case "location_button":
          result = await provider.sendLocationButton({ phone, ...payload.data });
          break;
      }

      await supabase
        .from("messages")
        .update({
          status: result?.success ? "sent" : "failed",
          whatsapp_msg_id: result?.messageId || null,
        })
        .eq("id", message.id);

      return { data: { ...(message as Message), status: result?.success ? "sent" : "failed", whatsapp_msg_id: result?.messageId || null } };
    } catch (err: any) {
      await supabase.from("messages").update({ status: "failed" }).eq("id", message.id);
      return { data: { ...(message as Message), status: "failed" }, error: err.message };
    }
  }

  return { data: message as Message };
}

/**
 * Envia Presença (Composing / Recording)
 */
export async function sendPresenceViaWhatsApp(
  conversationId: string,
  presence: "composing" | "recording" | "paused"
): Promise<{ error?: string }> {
  const { supabase, orgId } = await requireRole("agent");

  const { data: conversation } = await supabase
    .from("conversations")
    .select(`organization_id, channel, leads ( phone )`)
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (!conversation) return { error: "Conversa não encontrada" };
  const lead = (conversation as Record<string, unknown>).leads as Record<string, unknown> | null;
  const phone = lead?.phone as string | null;

  if (phone && conversation.channel === "whatsapp") {
    const { data: connection } = await supabase
      .from("whatsapp_connections")
      .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("organization_id", conversation.organization_id)
      .eq("status", "connected")
      .limit(1)
      .single();

    if (!connection) return { error: "Sem conexão" };

    try {
      const provider = createProvider(connection);
      if (typeof provider.sendPresence === 'function') {
        await provider.sendPresence({ phone, presence });
      }
    } catch {
      // Best effort, ignore errors
    }
  }

  return {};
}
