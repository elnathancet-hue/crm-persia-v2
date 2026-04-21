import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fetches the active WhatsApp connection for an organization.
 * Returns null if no connected instance exists.
 */
export async function getWhatsAppConnection(admin: SupabaseClient, orgId: string) {
  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("id, instance_url, instance_token, phone_number, status")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();

  return connection;
}
