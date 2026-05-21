/**
 * Campaign & Mass Sending Engine
 * Uses the native UAZAPI /sender/simple queue for reliable mass sending.
 * The UAZAPI queue handles delays, scheduling, and retry internally.
 */

import { createClient } from "@supabase/supabase-js";
import { errorMessage, logError, logInfo } from "@/lib/observability";
import { createProvider } from "./providers";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface CampaignJob {
  campaignId: string;
  orgId: string;
  message: string;
  targetTags: string[];
  intervalMs: number;  // used as delayMin; delayMax = intervalMs * 2
  scheduledFor?: string; // ISO date for scheduled sending
}

/**
 * Executa uma campanha de envio em massa usando o sender nativo do UAZAPI.
 * O UAZAPI gerencia a fila, delays e retries internamente.
 */
export async function executeCampaign(job: CampaignJob): Promise<{
  totalSent: number;
  totalFailed: number;
  errors: string[];
}> {
  const supabase = getSupabase();

  // 1. Get WhatsApp connection for this org
  const { data: connection } = await supabase
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", job.orgId)
    .eq("status", "connected")
    .single();

  if (!connection) {
    logError("campaign_execute_missing_connection", {
      organization_id: job.orgId,
      campaign_id: job.campaignId,
      provider: "whatsapp",
    });
    throw new Error("WhatsApp nao conectado");
  }

  const provider = createProvider(connection);

  // 2. Get leads with matching tags
  let query = supabase
    .from("leads")
    .select("id, phone, name")
    .eq("organization_id", job.orgId)
    .not("phone", "is", null);

  // If tags specified, filter by them
  if (job.targetTags.length > 0) {
    const { data: taggedLeadIds } = await supabase
      .from("lead_tags")
      .select("lead_id, tags!inner(name)")
      .in("tags.name", job.targetTags);

    if (taggedLeadIds && taggedLeadIds.length > 0) {
      const leadIds = [...new Set(taggedLeadIds.map((t: Record<string, unknown>) => t.lead_id as string))];
      query = query.in("id", leadIds);
    }
  }

  const { data: leads } = await query;
  if (!leads || leads.length === 0) {
    logInfo("campaign_execute_no_leads", {
      organization_id: job.orgId,
      campaign_id: job.campaignId,
      target_tags_count: job.targetTags.length,
    });
    return { totalSent: 0, totalFailed: 0, errors: ["Nenhum lead encontrado"] };
  }

  // 3. Update campaign status
  await supabase
    .from("campaigns")
    .update({ status: "sending" })
    .eq("id", job.campaignId);

  // 4. Collect phone numbers and build the native sender request
  const numbers: string[] = [];
  const leadByPhone = new Map<string, { id: string; name: string }>();

  for (const lead of leads) {
    if (!lead.phone) continue;
    const phone = String(lead.phone).replace(/\D/g, "");
    if (phone) {
      numbers.push(phone);
      leadByPhone.set(phone, { id: lead.id, name: lead.name || "" });
    }
  }

  if (numbers.length === 0) {
    logInfo("campaign_execute_no_valid_numbers", {
      organization_id: job.orgId,
      campaign_id: job.campaignId,
      lead_count: leads.length,
    });
    return { totalSent: 0, totalFailed: 0, errors: ["Nenhum telefone valido"] };
  }

  // 5. Use the native UAZAPI sender queue (much more reliable than sending one by one)
  const delayMin = Math.max(job.intervalMs, 1000);   // minimum 1 second
  const delayMax = Math.max(delayMin * 2, 3000);     // at least 3 seconds max

  try {
    const result = await provider.createCampaign({
      numbers,
      type: "text",
      text: job.message,
      delayMin,
      delayMax,
      scheduled_for: job.scheduledFor,
      folder: `campaign-${job.campaignId}`,
    });

    // Record all sends as queued (UAZAPI handles actual delivery)
    const sendRecords = numbers.map((phone) => {
      const lead = leadByPhone.get(phone);
      return {
        campaign_id: job.campaignId,
        organization_id: job.orgId,
        lead_id: lead?.id,
        phone,
        status: "queued",
        sent_at: new Date().toISOString(),
      };
    });

    // Insert in batches of 500 to avoid payload limits
    for (let i = 0; i < sendRecords.length; i += 500) {
      const batch = sendRecords.slice(i, i + 500);
      await supabase.from("campaign_sends").insert(batch);
    }

    // Update campaign with total
    await supabase
      .from("campaigns")
      .update({
        status: "queued",
        total_sent: numbers.length,
        sender_folder: result.folderId || `campaign-${job.campaignId}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.campaignId);

    logInfo("campaign_execute_queued", {
      organization_id: job.orgId,
      campaign_id: job.campaignId,
      provider: connection.provider,
      total_queued: numbers.length,
      scheduled: Boolean(job.scheduledFor),
    });

    return { totalSent: numbers.length, totalFailed: 0, errors: [] };
  } catch (e: unknown) {
    const errorMsg = errorMessage(e);

    // Update campaign as failed
    await supabase
      .from("campaigns")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.campaignId);

    logError("campaign_execute_failed", {
      organization_id: job.orgId,
      campaign_id: job.campaignId,
      provider: connection.provider,
      target_count: numbers.length,
      error: errorMsg,
    });

    return { totalSent: 0, totalFailed: numbers.length, errors: [errorMsg] };
  }
}

// Cleanup (mai/2026): funções `sendFollowUp`, `sendFollowupMessage`,
// `sendWhatsAppMessage` removidas — eram dead exports (zero callers no
// monorepo). Caminhos vivos hoje:
//   - Chat Live: `apps/crm/src/actions/messages.ts` (sendMessage)
//   - Admin chat: `apps/admin/src/actions/messages.ts` (sendMessage)
//   - Campanha: `executeCampaign` neste arquivo (via UAZAPI native queue)
//   - Follow-up IA: `apps/crm/src/lib/ai-agent/send-reply.ts`
//   - Agenda: `apps/crm/src/lib/agenda/notifications/dispatch.ts`
