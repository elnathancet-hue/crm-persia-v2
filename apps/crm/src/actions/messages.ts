"use server";

import { requireRole } from "@/lib/auth";
import { auditFailure, auditLog } from "@/lib/audit";
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
import { createProvider } from "@/lib/whatsapp/providers";

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
  created_at: string;
};

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
  content: string
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
      const result = await provider.sendText({ phone, message: content });
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

/**
 * Envia midia (imagem, audio, video, documento) via WhatsApp.
 * 1. Salva a midia no bucket privado chat-media
 * 2. Salva mensagem no DB com ref interna (chat-media:path)
 * 3. Envia via provider usando signed URL temporaria
 * 3. Retorna a mensagem salva
 */
export async function sendMediaViaWhatsApp(
  conversationId: string,
  file: {
    base64: string;
    type: "image" | "audio" | "video" | "document";
    fileName: string;
    caption?: string;
  }
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
  const admin = createAdminClient();

  const match = /^data:([^;]+);base64,(.+)$/.exec(file.base64);
  if (!match) return { error: "Formato de midia invalido" };

  const mimeType = match[1];
  const content = match[2];
  const buffer = Buffer.from(content, "base64");
  if (buffer.byteLength > 16 * 1024 * 1024) {
    return { error: "Arquivo maior que 16MB" };
  }

  await ensureChatMediaBucket(admin);
  const mediaPath = createChatMediaPath({ orgId, conversationId, fileName: file.fileName });
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
      metadata: { stage: "upload", media_type: file.type, mime_type: mimeType, bytes: buffer.byteLength },
      error: uploadError,
    });
    return { error: uploadError.message };
  }

  const mediaRef = toChatMediaRef(mediaPath);

  // 3. Save message to DB with status='sending'
  const now = new Date().toISOString();

  const { data: message, error: msgError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      organization_id: conversation.organization_id,
      lead_id: conversation.lead_id,
      sender: "agent",
      sender_user_id: userId,
      content: file.caption || null,
      type: file.type,
      media_url: mediaRef,
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
      metadata: { stage: "save_message", media_type: file.type, mime_type: mimeType, bytes: buffer.byteLength },
      error: msgError,
    });
    return { error: msgError.message };
  }

  await supabase
    .from("conversations")
    .update({ last_message_at: now, unread_count: 0, updated_at: now })
    .eq("id", conversationId);

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
        metadata: { conversation_id: conversationId, media_type: file.type, stage: "missing_connection" },
        error: new Error("Nenhuma conexao WhatsApp ativa"),
      });
      return { data: { ...(message as Message), media_url: signedMediaUrl, status: "failed" }, error: "Nenhuma conexao WhatsApp ativa" };
    }

    try {
      const provider = createProvider(connection);
      const providerMediaUrl = await resolveProviderChatMediaUrl(admin, mediaRef);
      const result = await provider.sendMedia({
        phone,
        type: file.type,
        media: providerMediaUrl,
        caption: file.caption,
        fileName: file.type === "document" ? file.fileName : undefined,
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
        metadata: { conversation_id: conversationId, media_type: file.type, provider: connection.provider },
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
        metadata: { conversation_id: conversationId, media_type: file.type, stage: "provider_send" },
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
    metadata: { conversation_id: conversationId, media_type: file.type, channel: conversation.channel },
  });
  return { data: { ...(message as Message), media_url: signedMediaUrl, status: "sent" } };
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
