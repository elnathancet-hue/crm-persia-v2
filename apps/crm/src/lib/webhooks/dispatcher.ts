import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Dispatch outbound webhooks for an event.
 * Call this from anywhere in the system when something happens.
 *
 * Events: lead.created, lead.updated, message.received, message.sent,
 *         conversation.created, conversation.closed, deal.created, deal.moved
 *
 * Usage:
 *   await dispatchWebhook(orgId, "lead.created", { lead: { id, name, phone } });
 */
export async function dispatchWebhook(
  orgId: string,
  event: string,
  payload: Record<string, unknown>
) {
  try {
    const supabase = getSupabase();

    // Find active outbound webhooks for this org + event
    const { data: webhooks } = await supabase
      .from("webhooks")
      .select("id, url, events, secret_token")
      .eq("organization_id", orgId)
      .eq("direction", "outbound")
      .eq("is_active", true);

    if (!webhooks || webhooks.length === 0) return;

    const now = new Date().toISOString();

    for (const webhook of webhooks) {
      // Check if this webhook listens to this event
      const events: string[] = webhook.events || [];
      if (events.length > 0 && !events.includes(event) && !events.includes("*")) {
        continue;
      }

      // Fire and forget - don't block the main flow
      fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": event,
          "X-Webhook-Timestamp": now,
          ...(webhook.secret_token ? { "X-Webhook-Secret": webhook.secret_token } : {}),
        },
        body: JSON.stringify({
          event,
          timestamp: now,
          organization_id: orgId,
          data: payload,
        }),
      }).catch((err) => {
        console.error(`[Webhook] Failed to dispatch ${event} to ${webhook.url}:`, err.message);
      });
    }
  } catch (err: any) {
    console.error("[Webhook] Dispatcher error:", err.message);
  }
}
