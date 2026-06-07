// send-scheduled-worker.ts — lógica extraída de /api/cron/send-scheduled
// para permitir composição no cron global /api/cron/all.

import { createClient } from "@supabase/supabase-js";
import { createProvider } from "@/lib/whatsapp/providers";

export interface SendScheduledResult {
  sent: number;
  failed?: number;
  skipped?: number;
}

export async function processScheduledMessages(): Promise<SendScheduledResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: messages, error } = await supabase
    .from("scheduled_messages")
    .select("*, leads(phone), conversations(organization_id, channel)")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(20);

  if (error || !messages || messages.length === 0) {
    if (error) console.error("[SendScheduled] fetch error:", error.message);
    return { sent: 0, failed: 0, skipped: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const msg of messages) {
    try {
      await supabase
        .from("scheduled_messages")
        .update({ attempts: (msg.attempts ?? 0) + 1 })
        .eq("id", msg.id);

      const phone = (msg.leads as any)?.phone;
      const orgId = (msg.conversations as any)?.organization_id;
      const channel = (msg.conversations as any)?.channel;

      if (!phone || !orgId || channel !== "whatsapp") {
        skippedCount++;
        await supabase
          .from("scheduled_messages")
          .update({ status: "error", error_message: "Conversa sem destinatario WhatsApp valido" })
          .eq("id", msg.id);
        continue;
      }

      const { data: connection } = await supabase
        .from("whatsapp_connections")
        .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
        .eq("organization_id", orgId)
        .eq("status", "connected")
        .limit(1)
        .single();

      if (!connection) {
        failedCount++;
        await supabase
          .from("scheduled_messages")
          .update({ status: "error", error_message: "Nenhuma conexao WhatsApp ativa" })
          .eq("id", msg.id);
        continue;
      }

      const provider = createProvider(connection as never);
      const content = typeof msg.content === "string" ? msg.content.trim() : "";
      const mediaType = msg.media_type ?? "none";
      const result = mediaType !== "none" && msg.media_url
        ? await provider.sendMedia({
          phone,
          type: mediaType as "image" | "video" | "audio" | "document",
          media: msg.media_url,
          caption: content || undefined,
          fileName: msg.media_filename ?? undefined,
        })
        : await provider.sendText({ phone, message: content });

      await supabase.from("messages").insert({
        organization_id: orgId,
        conversation_id: msg.conversation_id,
        lead_id: msg.lead_id,
        content: content || null,
        sender: "agent",
        sender_user_id: msg.created_by,
        type: mediaType !== "none" ? mediaType : (msg.type || "text"),
        media_url: msg.media_url ?? null,
        media_type: msg.media_mime_type ?? null,
        status: "sent",
        whatsapp_msg_id: result.messageId ?? null,
        metadata: {
          scheduled_message_id: msg.id,
          media_filename: msg.media_filename ?? null,
          media_size: msg.media_size ?? null,
        },
      });

      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString(), unread_count: 0, updated_at: new Date().toISOString() })
        .eq("id", msg.conversation_id);

      await supabase
        .from("scheduled_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
        .eq("id", msg.id);

      sentCount++;
    } catch (err: unknown) {
      const msgErr = err instanceof Error ? err.message : String(err);
      console.error(`[SendScheduled] Error sending message ${msg.id}:`, msgErr);
      failedCount++;
      await supabase
        .from("scheduled_messages")
        .update({ status: "error", error_message: msgErr })
        .eq("id", msg.id);
    }
  }

  return { sent: sentCount, failed: failedCount, skipped: skippedCount };
}

export async function processScheduledGroupMessages(): Promise<SendScheduledResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: messages, error } = await supabase
    .from("scheduled_group_messages")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(20);

  if (error || !messages || messages.length === 0) {
    if (error) console.error("[SendScheduledGroup] fetch error:", error.message);
    return { sent: 0, failed: 0, skipped: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const msg of messages) {
    try {
      await supabase
        .from("scheduled_group_messages")
        .update({ attempts: (msg.attempts ?? 0) + 1 })
        .eq("id", msg.id);

      const { data: connection } = await supabase
        .from("whatsapp_connections")
        .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
        .eq("organization_id", msg.organization_id)
        .eq("status", "connected")
        .limit(1)
        .single();

      if (!connection) {
        failedCount++;
        await supabase
          .from("scheduled_group_messages")
          .update({ status: "error", error_message: "Nenhuma conexao WhatsApp ativa" })
          .eq("id", msg.id);
        continue;
      }

      const provider = createProvider(connection as never);
      const content = typeof msg.content === "string" ? msg.content.trim() : "";
      const mediaType = msg.media_type ?? null;
      const result = mediaType && msg.media_url
        ? await provider.sendMedia({
          phone: msg.group_jid,
          type: mediaType as "image" | "video" | "audio" | "document",
          media: msg.media_url,
          caption: content || undefined,
          fileName: msg.media_filename ?? undefined,
        })
        : await provider.sendText({ phone: msg.group_jid, message: content });

      await supabase.from("group_messages").insert({
        organization_id: msg.organization_id,
        group_id: msg.group_id,
        direction: "outbound",
        text: content || null,
        media_url: msg.media_url ?? null,
        media_type: msg.media_mime_type ?? null,
        status: "sent",
        whatsapp_msg_id: result.messageId ?? null,
        created_at: new Date().toISOString(),
      });

      await supabase
        .from("scheduled_group_messages")
        .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
        .eq("id", msg.id);

      sentCount++;
    } catch (err: unknown) {
      const msgErr = err instanceof Error ? err.message : String(err);
      console.error(`[SendScheduledGroup] Error sending group message ${msg.id}:`, msgErr);
      failedCount++;
      await supabase
        .from("scheduled_group_messages")
        .update({ status: "error", error_message: msgErr })
        .eq("id", msg.id);
    }
  }

  return { sent: sentCount, failed: failedCount };
}
