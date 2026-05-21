import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createProvider } from "@/lib/whatsapp/providers";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  // Find pending scheduled messages that are due
  const { data: messages, error } = await supabase
    .from("scheduled_messages")
    .select("*, leads(phone), conversations(organization_id, channel)")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .limit(20);

  if (error || !messages || messages.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  let sentCount = 0;

  for (const msg of messages) {
    try {
      const phone = (msg.leads as any)?.phone;
      const orgId = (msg.conversations as any)?.organization_id;

      if (!phone || !orgId) continue;

      // Get WhatsApp connection
      const { data: connection } = await supabase
        .from("whatsapp_connections")
        .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
        .eq("organization_id", orgId)
        .eq("status", "connected")
        .limit(1)
        .single();

      if (!connection) continue;

      const provider = createProvider(connection);

      // Send the message (captura messageId pra webhook messages_update
      // — Bug B — conseguir casar update de status delivered/read).
      const result = await provider.sendText({ phone, message: msg.content });

      // Bug F fix (mai/2026): persistir whatsapp_msg_id + status='sent'.
      // Sem isso (a) webhook messages_update não casa → status nunca
      // evolui pra delivered/read; (b) dedup de inbound futuro falha;
      // (c) UI mostra mensagem com checkmark indefinido.
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

      // Mark as sent
      await supabase
        .from("scheduled_messages")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", msg.id);

      sentCount++;
    } catch (err: any) {
      console.error(`[Cron] Error sending scheduled message ${msg.id}:`, err.message);
      await supabase
        .from("scheduled_messages")
        .update({ status: "error" })
        .eq("id", msg.id);
    }
  }

  return NextResponse.json({ ok: true, sent: sentCount });
}
