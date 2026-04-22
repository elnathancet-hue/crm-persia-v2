/**
 * CRM <-> UAZAPI Bidirectional Sync Service
 *
 * Syncs lead data from Supabase to UAZAPI whenever CRM data changes.
 * All functions are fire-and-forget safe - errors are logged but never thrown.
 */

import { createClient } from "@supabase/supabase-js";
import { createProvider } from "./providers";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getConnection(orgId: string) {
  const supabase = getSupabase();
  const { data: conn } = await supabase
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .single();
  return conn;
}

/**
 * Syncs lead data from Supabase to UAZAPI.
 * Call this whenever a lead is updated in our CRM.
 */
export async function syncLeadToUazapi(orgId: string, leadId: string): Promise<void> {
  try {
    const supabase = getSupabase();

    // 1. Get lead from our DB
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();
    if (!lead?.phone) return;

    // 2. Get tags
    const { data: leadTags } = await supabase
      .from("lead_tags")
      .select("tags(name)")
      .eq("lead_id", leadId);
    const tags = (leadTags || [])
      .map((t: Record<string, unknown>) => (t.tags as Record<string, unknown>)?.name as string)
      .filter(Boolean);

    // 3. Get custom fields
    const { data: customValues } = await supabase
      .from("lead_custom_field_values")
      .select("custom_fields(field_key), value")
      .eq("lead_id", leadId);

    const customFields: Record<string, string> = {};
    if (customValues) {
      for (const cv of customValues) {
        const cfRaw = cv.custom_fields as unknown as Record<string, unknown> | null;
        const fieldKey = cfRaw?.field_key as string | undefined;
        if (fieldKey) {
          customFields[fieldKey] = cv.value as string;
        }
      }
    }

    // 4. Get deal info (kanban position)
    const { data: deal } = await supabase
      .from("deals")
      .select("pipeline_stages(name, sort_order)")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // 5. Get WhatsApp connection
    const conn = await getConnection(orgId);
    if (!conn) return;

    // 6. Sync to UAZAPI
    const provider = createProvider(conn);
    await provider.syncLeadToWhatsApp(lead.phone, {
      name: lead.name || undefined,
      email: lead.email || undefined,
      status: lead.status || undefined,
      tags,
      kanbanOrder: deal
        ? ((deal as Record<string, unknown>).pipeline_stages as Record<string, unknown>)?.sort_order as number * 1000
        : undefined,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CRM Sync] syncLeadToUazapi error", {
      organization_id: orgId,
      lead_id: leadId,
      error: message,
    });
  }
}

/**
 * Disables chatbot for a chat when agent takes over.
 * Default: 8 hours (480 minutes).
 */
export async function disableChatbotForLead(
  orgId: string,
  phone: string,
  minutes: number = 480
): Promise<void> {
  try {
    const conn = await getConnection(orgId);
    if (!conn) return;

    const provider = createProvider(conn);
    await provider.disableChatbotFor(phone, minutes);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CRM Sync] disableChatbotForLead error", {
      organization_id: orgId,
      error: message,
    });
  }
}

/**
 * Re-enables chatbot when conversation is closed or returned to AI.
 */
export async function enableChatbotForLead(orgId: string, phone: string): Promise<void> {
  try {
    const conn = await getConnection(orgId);
    if (!conn) return;

    const provider = createProvider(conn);
    await provider.enableChatbot(phone);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CRM Sync] enableChatbotForLead error", {
      organization_id: orgId,
      error: message,
    });
  }
}

/**
 * Syncs ticket open status and assigned attendant to UAZAPI.
 */
export async function syncTicketStatusToUazapi(
  orgId: string,
  phone: string,
  isOpen: boolean,
  assignedTo?: string
): Promise<void> {
  try {
    const conn = await getConnection(orgId);
    if (!conn) return;

    const provider = createProvider(conn);
    await provider.syncLeadToWhatsApp(phone, {
      isTicketOpen: isOpen,
      assignedTo: assignedTo || undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CRM Sync] syncTicketStatusToUazapi error", {
      organization_id: orgId,
      ticket_open: isOpen,
      assigned: Boolean(assignedTo),
      error: message,
    });
  }
}

/**
 * Sets up the default fields map on an instance.
 * Call once when instance becomes connected.
 */
export async function setupFieldsMap(instanceUrl: string, instanceToken: string): Promise<void> {
  try {
    const provider = createProvider({ provider: "uazapi", instance_url: instanceUrl, instance_token: instanceToken });
    // Access the underlying client to call updateFieldsMap
    // We use a direct fetch here since the provider interface doesn't expose this admin-level call
    const url = `${instanceUrl.replace(/\/$/, "")}/instance/updateFieldsMap`;
    await fetch(url, {
      method: "POST",
      headers: {
        token: instanceToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lead_field01: "cpf_cnpj",
        lead_field02: "empresa",
        lead_field03: "cargo",
        lead_field04: "cidade",
        lead_field05: "estado",
        lead_field06: "interesse",
        lead_field07: "origem",
        lead_field08: "valor_deal",
        lead_field09: "pipeline_stage",
        lead_field10: "score",
      }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CRM Sync] setupFieldsMap error:", message);
  }
}
