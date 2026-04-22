"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { auditFailure, auditLog } from "@/lib/audit";
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

const CHAT_MEDIA_BUCKET = "chat-media";

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
    return { data: updated as Message, error: "Nenhuma conexao WhatsApp ativa" };
  }

  try {
    const provider = createProvider(connection);
    let result;
    if (message.type === "text") {
      result = await provider.sendText({ phone, message: message.content || "" });
    } else if (message.type && ["image", "audio", "video", "document"].includes(message.type)) {
      if (!message.media_url) throw new Error("Media ausente para reenvio");
      result = await provider.sendMedia({
        phone,
        type: message.type as "image" | "audio" | "video" | "document",
        media: message.media_url,
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
    return { data: updated as Message };
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
    return { data: updated as Message, error: reason };
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

  return { data: (data || []).reverse() as Message[], error: null };
}

/**
 * Upload base64 media to Supabase Storage and return a public URL.
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

  // Ensure bucket exists (idempotent)
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((b) => b.name === CHAT_MEDIA_BUCKET)) {
    await admin.storage.createBucket(CHAT_MEDIA_BUCKET, { public: true });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  const path = `${orgId}/${conversationId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) return { error: uploadError.message };

  const { data } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
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
 * `mediaUrl` must be a public URL (use uploadChatMedia first).
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
      return { data: { ...(message as Message), status: "failed" }, error: "Nenhuma conexao WhatsApp ativa" };
    }

    try {
      const provider = createProvider(connection);
      const result = await provider.sendMedia({
        phone,
        type: file.type,
        media: file.mediaUrl,
        caption: file.caption,
        fileName: file.type === "document" ? file.fileName : undefined,
      });
      const update: Record<string, unknown> = { status: "sent" };
      if (result.messageId) update.whatsapp_msg_id = result.messageId;
      await admin.from("messages").update(update).eq("id", message.id);
      await auditLog({ userId, orgId, action: "send_media", entityType: "conversation", entityId: conversationId, metadata: { type: file.type } });
      return { data: { ...(message as Message), status: "sent", whatsapp_msg_id: result.messageId ?? null } };
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
      return { data: { ...(message as Message), status: "failed" }, error: reason };
    }
  }

  await admin.from("messages").update({ status: "sent" }).eq("id", message.id);
  await auditLog({ userId, orgId, action: "send_media", entityType: "conversation", entityId: conversationId, metadata: { type: file.type } });
  return { data: { ...(message as Message), status: "sent" } };
}
