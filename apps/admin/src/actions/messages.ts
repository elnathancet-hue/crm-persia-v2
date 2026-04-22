"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
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

/**
 * Lightweight WhatsApp connection status check (DB-only, does not poll UAZAPI).
 * Used by the chat UI to show a banner when disconnected.
 */
export async function getWhatsAppConnectionStatus(): Promise<{ connected: boolean; provider: string | null }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin
    .from("whatsapp_connections")
    .select("status, provider")
    .eq("organization_id", orgId)
    .limit(1)
    .single();
  return {
    connected: data?.status === "connected",
    provider: (data?.provider as string) ?? null,
  };
}

/**
 * Retry sending a previously failed message.
 * Re-runs the provider call with the original content; updates status in-place.
 */
export async function resendMessage(
  messageId: string
): Promise<{ data?: Message; error?: string }> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();

  const { data: message, error: fetchError } = await admin
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

  await admin.from("messages").update({ status: "sending" }).eq("id", messageId);

  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();

  if (!connection) {
    const { data: updated } = await admin
      .from("messages")
      .update({ status: "failed" })
      .eq("id", messageId)
      .select()
      .single();
    const signed = await withSignedChatMediaUrls(admin, [updated as Message]);
    return { data: signed[0], error: "Nenhuma conexao WhatsApp ativa" };
  }

  try {
    const provider = createProvider(connection);
    let result;
    if (message.type === "text") {
      result = await provider.sendText({ phone, message: message.content || "" });
    } else if (message.type && ["image", "audio", "video", "document"].includes(message.type)) {
      if (!message.media_url) throw new Error("Media ausente para reenvio");
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
    const { data: updated } = await admin
      .from("messages")
      .update(update)
      .eq("id", messageId)
      .select()
      .single();

    await auditLog({ userId, orgId, action: "resend_message", entityType: "conversation", entityId: message.conversation_id, metadata: { messageId } });
    const signed = await withSignedChatMediaUrls(admin, [updated as Message]);
    return { data: signed[0] };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Falha ao reenviar";
    await auditFailure({
      userId,
      orgId,
      action: "resend_message",
      entityType: "conversation",
      entityId: message.conversation_id,
      metadata: { messageId },
      error: err,
    });
    const { data: updated } = await admin
      .from("messages")
      .update({ status: "failed" })
      .eq("id", messageId)
      .select()
      .single();
    const signed = await withSignedChatMediaUrls(admin, [updated as Message]);
    return { data: signed[0], error: reason };
  }
}

export async function getMessages(
  conversationId: string,
  options: { limit?: number; before?: string } = {}
) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { limit = 50, before } = options;

  let query = admin
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };

  const signedMessages = await withSignedChatMediaUrls(admin, (data || []).reverse() as Message[]);
  return { data: signedMessages, error: null };
}

/**
 * Upload base64 media to Supabase Storage and return an internal media ref.
 * Used before sending via WhatsApp to avoid storing base64 in the DB row.
 */
export async function uploadChatMedia(
  conversationId: string,
  base64: string,
  fileName: string
): Promise<{ url?: string; error?: string }> {
  const { admin, orgId } = await requireSuperadminForOrg();

  // Validate conversation is in active org
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();
  if (!conv) return { error: "Conversa nao encontrada nesta organizacao" };

  // Parse data URL: "data:<mime>;base64,<content>"
  const match = /^data:([^;]+);base64,(.+)$/.exec(base64);
  if (!match) return { error: "Formato de midia invalido" };
  const mimeType = match[1];
  const content = match[2];

  const buffer = Buffer.from(content, "base64");
  if (buffer.byteLength > 16 * 1024 * 1024) {
    return { error: "Arquivo maior que 16MB" };
  }

  await ensureChatMediaBucket(admin);
  const path = createChatMediaPath({ orgId, conversationId, fileName });

  const { error: uploadError } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) return { error: uploadError.message };

  return { url: toChatMediaRef(path) };
}

export async function resolveMessageMediaUrl(
  messageId: string
): Promise<{ url: string | null; error?: string }> {
  const { admin, orgId } = await requireSuperadminForOrg();
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

/**
 * Send text message via WhatsApp.
 * On provider failure, the DB message is marked status='failed' and error is returned
 * alongside the message so the UI can show a retry affordance.
 */
export async function sendMessageViaWhatsApp(
  conversationId: string,
  content: string
): Promise<{ data?: Message; error?: string }> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();

  const { data: conversation, error: convError } = await admin
    .from("conversations")
    .select("id, lead_id, organization_id, channel, leads (id, phone)")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (convError || !conversation) return { error: "Conversa nao encontrada nesta organizacao" };

  const lead = (conversation as Record<string, unknown>).leads as Record<string, unknown> | null;
  const phone = lead?.phone as string | null;
  const now = new Date().toISOString();

  const { data: message, error: msgError } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      organization_id: orgId,
      lead_id: conversation.lead_id,
      sender: "agent",
      sender_user_id: userId,
      content,
      type: "text",
      status: "sending",
    })
    .select()
    .single();

  if (msgError) return { error: msgError.message };

  await admin
    .from("conversations")
    .update({ last_message_at: now, unread_count: 0, updated_at: now })
    .eq("id", conversationId)
    .eq("organization_id", orgId);

  if (phone && conversation.channel === "whatsapp") {
    const { data: connection } = await admin
      .from("whatsapp_connections")
      .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("organization_id", orgId)
      .eq("status", "connected")
      .limit(1)
      .single();

    if (!connection) {
      await admin.from("messages").update({ status: "failed" }).eq("id", message.id);
      return { data: { ...(message as Message), status: "failed" }, error: "Nenhuma conexao WhatsApp ativa" };
    }

    try {
      const provider = createProvider(connection);
      const result = await provider.sendText({ phone, message: content });
      const update: Record<string, unknown> = { status: "sent" };
      if (result.messageId) update.whatsapp_msg_id = result.messageId;
      await admin.from("messages").update(update).eq("id", message.id);
      await auditLog({ userId, orgId, action: "send_message", entityType: "conversation", entityId: conversationId });
      return { data: { ...(message as Message), status: "sent", whatsapp_msg_id: result.messageId ?? null } };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Falha ao enviar ao WhatsApp";
      await auditFailure({
        userId,
        orgId,
        action: "send_message",
        entityType: "conversation",
        entityId: conversationId,
        metadata: { messageId: message.id },
        error: err,
      });
      await admin.from("messages").update({ status: "failed" }).eq("id", message.id);
      return { data: { ...(message as Message), status: "failed" }, error: reason };
    }
  }

  await admin.from("messages").update({ status: "sent" }).eq("id", message.id);
  await auditLog({ userId, orgId, action: "send_message", entityType: "conversation", entityId: conversationId });
  return { data: { ...(message as Message), status: "sent" } };
}

/**
 * Send media message via WhatsApp.
 * `mediaUrl` may be a legacy public URL or an internal chat-media ref.
 */
export async function sendMediaViaWhatsApp(
  conversationId: string,
  file: {
    mediaUrl: string;
    type: "image" | "audio" | "video" | "document";
    fileName: string;
    caption?: string;
  }
): Promise<{ data?: Message; error?: string }> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();

  const { data: conversation, error: convError } = await admin
    .from("conversations")
    .select("id, lead_id, organization_id, channel, leads (id, phone)")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .single();

  if (convError || !conversation) return { error: "Conversa nao encontrada nesta organizacao" };

  const lead = (conversation as Record<string, unknown>).leads as Record<string, unknown> | null;
  const phone = lead?.phone as string | null;
  const now = new Date().toISOString();

  const { data: message, error: msgError } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      organization_id: orgId,
      lead_id: conversation.lead_id,
      sender: "agent",
      sender_user_id: userId,
      content: file.caption || null,
      type: file.type,
      media_url: file.mediaUrl,
      status: "sending",
    })
    .select()
    .single();

  if (msgError) return { error: msgError.message };

  await admin
    .from("conversations")
    .update({ last_message_at: now, unread_count: 0, updated_at: now })
    .eq("id", conversationId)
    .eq("organization_id", orgId);

  if (phone && conversation.channel === "whatsapp") {
    const { data: connection } = await admin
      .from("whatsapp_connections")
      .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
      .eq("organization_id", orgId)
      .eq("status", "connected")
      .limit(1)
      .single();

    if (!connection) {
      await admin.from("messages").update({ status: "failed" }).eq("id", message.id);
      const signedMediaUrl = await resolveChatMediaUrl(admin, file.mediaUrl);
      return { data: { ...(message as Message), media_url: signedMediaUrl, status: "failed" }, error: "Nenhuma conexao WhatsApp ativa" };
    }

    try {
      const provider = createProvider(connection);
      const providerMediaUrl = await resolveProviderChatMediaUrl(admin, file.mediaUrl);
      const result = await provider.sendMedia({
        phone,
        type: file.type,
        media: providerMediaUrl,
        caption: file.caption,
        fileName: file.type === "document" ? file.fileName : undefined,
      });
      const update: Record<string, unknown> = { status: "sent" };
      if (result.messageId) update.whatsapp_msg_id = result.messageId;
      await admin.from("messages").update(update).eq("id", message.id);
      await auditLog({ userId, orgId, action: "send_media", entityType: "conversation", entityId: conversationId, metadata: { type: file.type } });
      const signedMediaUrl = await resolveChatMediaUrl(admin, file.mediaUrl);
      return { data: { ...(message as Message), media_url: signedMediaUrl, status: "sent", whatsapp_msg_id: result.messageId ?? null } };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Falha ao enviar ao WhatsApp";
      await auditFailure({
        userId,
        orgId,
        action: "send_media",
        entityType: "conversation",
        entityId: conversationId,
        metadata: { messageId: message.id, type: file.type },
        error: err,
      });
      await admin.from("messages").update({ status: "failed" }).eq("id", message.id);
      const signedMediaUrl = await resolveChatMediaUrl(admin, file.mediaUrl);
      return { data: { ...(message as Message), media_url: signedMediaUrl, status: "failed" }, error: reason };
    }
  }

  await admin.from("messages").update({ status: "sent" }).eq("id", message.id);
  await auditLog({ userId, orgId, action: "send_media", entityType: "conversation", entityId: conversationId, metadata: { type: file.type } });
  const signedMediaUrl = await resolveChatMediaUrl(admin, file.mediaUrl);
  return { data: { ...(message as Message), media_url: signedMediaUrl, status: "sent" } };
}
