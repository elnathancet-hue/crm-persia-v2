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

      // Send the message
      await provider.sendText({ phone, message: msg.content });

      // Save to messages table
      await supabase.from("messages").insert({
        organization_id: orgId,
        conversation_id: msg.conversation_id,
        lead_id: msg.lead_id,
        content: msg.content,
        sender: "agent",
        sender_user_id: msg.created_by,
        type: msg.type || "text",
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
