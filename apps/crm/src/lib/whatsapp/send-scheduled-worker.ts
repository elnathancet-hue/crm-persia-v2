// send-scheduled-worker.ts — lógica extraída de /api/cron/send-scheduled
// para permitir composição no cron global /api/cron/all.

import { createClient } from "@supabase/supabase-js";
import { createProvider } from "@/lib/whatsapp/providers";

export interface SendScheduledResult {
  sent: number;
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
    .limit(20);

  if (error || !messages || messages.length === 0) {
    return { sent: 0 };
  }

  let sentCount = 0;

  for (const msg of messages) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const phone = (msg.leads as any)?.phone;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orgId = (msg.conversations as any)?.organization_id;

      if (!phone || !orgId) continue;

      const { data: connection } = await supabase
        .from("whatsapp_connections")
        .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
        .eq("organization_id", orgId)
        .eq("status", "connected")
        .limit(1)
        .single();

      if (!connection) continue;

      const provider = createProvider(connection as never);
      const result = await provider.sendText({ phone, message: msg.content });

      await supabase.from("messages").insert({
        organization_id: orgId,
        conversation_id: msg.conversation_id,
        lead_id: msg.lead_id,
        content: msg.content,
        sender: "agent",
        sender_user_id: msg.created_by,
        type: msg.type || "text",
        status: "sent",
        whatsapp_msg_id: result.messageId ?? null,
      });

      await supabase
        .from("scheduled_messages")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", msg.id);

      sentCount++;
    } catch (err: unknown) {
      const msgErr = err instanceof Error ? err.message : String(err);
      console.error(`[SendScheduled] Error sending message ${msg.id}:`, msgErr);
      await supabase
        .from("scheduled_messages")
        .update({ status: "error" })
        .eq("id", msg.id);
    }
  }

  return { sent: sentCount };
}
