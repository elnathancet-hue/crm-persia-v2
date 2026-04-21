import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/supabase-admin";
import { createProvider } from "@/lib/whatsapp/providers";
import { hasTemplates, type WhatsAppConnection } from "@/lib/whatsapp/provider";
import { buildTemplateComponents, type ParamsSchema } from "@/lib/whatsapp/template-parser";

/**
 * Outbox worker para campanhas com template Meta Cloud.
 *
 * Lê wa_template_sends com status='queued' e campaign_id definido (campanha),
 * envia via Graph API, persiste mensagem e atualiza status. Limita a BATCH_SIZE
 * sends por run para evitar timeout do cron.
 *
 * EasyPanel cron recomendado: a cada 1 minuto.
 *   curl -sS -H "Authorization: Bearer $CRON_SECRET" \
 *        "$ADMIN_URL/api/cron/process-campaign-sends"
 *
 * O `send_interval_seconds` da campanha define o rate real:
 *   - interval 5s  → 12 sends/min → batch 12 (ok em 1 run)
 *   - interval 30s → 2 sends/min  → batch 2
 *   - interval 60s → 1 send/min
 * Aqui usamos um limite conservador fixo (30) para nao bater rate limit Meta
 * (tier inicial ~1000/s, mas respeitamos a escolha do operador).
 */

const BATCH_SIZE = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

interface QueuedRow {
  id: string;
  organization_id: string;
  template_id: string;
  campaign_id: string;
  lead_id: string | null;
  variables: unknown;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdmin();
  const summary = { processed: 0, sent: 0, failed: 0, campaignsCompleted: 0 };

  const { data: queued } = await admin
    .from("wa_template_sends")
    .select("id, organization_id, template_id, campaign_id, lead_id, variables")
    .eq("status", "queued")
    .not("campaign_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!queued || queued.length === 0) {
    return NextResponse.json({ ok: true, ...summary, timestamp: new Date().toISOString() });
  }

  // Cache de connection por org (todas as sends de uma org usam a mesma conn).
  const connCache = new Map<string, WhatsAppConnection | null>();
  // Cache de template (id → {name, language, components, params_schema}).
  const tplCache = new Map<string, { name: string; language: string; components: unknown; params_schema: ParamsSchema } | null>();
  // Lead cache.
  const leadCache = new Map<string, { id: string; phone: string } | null>();

  const touchedCampaigns = new Set<string>();

  for (const row of queued as QueuedRow[]) {
    summary.processed++;
    touchedCampaigns.add(row.campaign_id);

    try {
      // Load conn (cached per org).
      let conn = connCache.get(row.organization_id);
      if (conn === undefined) {
        const { data } = await admin
          .from("whatsapp_connections")
          .select("id, provider, phone_number_id, waba_id, access_token, webhook_verify_token")
          .eq("organization_id", row.organization_id)
          .eq("provider", "meta_cloud")
          .eq("status", "connected")
          .limit(1)
          .maybeSingle();
        conn = (data as WhatsAppConnection | null) ?? null;
        connCache.set(row.organization_id, conn);
      }
      if (!conn) throw new Error("Conexao Meta Cloud indisponivel");

      const provider = createProvider(conn);
      if (!hasTemplates(provider)) throw new Error("Provider sem suporte a templates");

      // Load template.
      let tpl = tplCache.get(row.template_id);
      if (tpl === undefined) {
        const { data } = await admin
          .from("wa_templates")
          .select("name, language, status, components, params_schema")
          .eq("id", row.template_id)
          .maybeSingle();
        const t = data as { name: string; language: string; status: string; components: unknown; params_schema: unknown } | null;
        tpl = t && t.status === "APPROVED"
          ? { name: t.name, language: t.language, components: t.components, params_schema: t.params_schema as ParamsSchema }
          : null;
        tplCache.set(row.template_id, tpl);
      }
      if (!tpl) throw new Error("Template indisponivel ou nao APPROVED");

      // Load lead (phone required).
      if (!row.lead_id) throw new Error("Lead ausente");
      let lead = leadCache.get(row.lead_id);
      if (lead === undefined) {
        const { data } = await admin
          .from("leads")
          .select("id, phone")
          .eq("id", row.lead_id)
          .maybeSingle();
        lead = (data as { id: string; phone: string } | null) ?? null;
        leadCache.set(row.lead_id, lead);
      }
      if (!lead?.phone) throw new Error("Lead sem telefone");

      // Build components + send.
      const components = buildTemplateComponents(
        tpl.params_schema,
        (row.variables ?? {}) as Parameters<typeof buildTemplateComponents>[1],
      );
      const result = await provider.sendTemplate({
        phone: lead.phone,
        templateName: tpl.name,
        language: tpl.language,
        components,
      });

      const now = new Date().toISOString();
      await admin
        .from("wa_template_sends")
        .update({ status: "sent", wamid: result.messageId, sent_at: now })
        .eq("id", row.id);

      // Ensure a conversation exists so the template message is visible in the chat.
      // Reuse an open conversation for this lead, or create one.
      let conversationId: string | null = null;
      const { data: existingConv } = await admin
        .from("conversations")
        .select("id")
        .eq("organization_id", row.organization_id)
        .eq("lead_id", row.lead_id)
        .neq("status", "closed")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
        await admin
          .from("conversations")
          .update({ last_message_at: now, updated_at: now })
          .eq("id", conversationId);
      } else {
        const { data: newConv } = await admin
          .from("conversations")
          .insert({
            organization_id: row.organization_id,
            lead_id: row.lead_id,
            channel: "whatsapp",
            status: "active",
            assigned_to: "ai",
            last_message_at: now,
          })
          .select("id")
          .single();
        conversationId = newConv?.id ?? null;
      }

      await admin.from("messages").insert({
        organization_id: row.organization_id,
        conversation_id: conversationId,
        lead_id: row.lead_id,
        sender: "agent",
        content: "[Template enviado via campanha]",
        type: "template",
        status: "sent",
        whatsapp_msg_id: result.messageId,
        template_send_id: row.id,
        metadata: {
          template_id: row.template_id,
          campaign_id: row.campaign_id,
          variables: row.variables,
        },
      } as never);

      summary.sent++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin
        .from("wa_template_sends")
        .update({
          status: "failed",
          error_detail: msg,
          // sent_at nao preenchido
        })
        .eq("id", row.id);
      summary.failed++;
      console.error(`[cron/process-campaign-sends] org=${row.organization_id} send=${row.id} failed:`, msg);
    }
  }

  // Finalize campanhas cujos sends acabaram.
  for (const campaignId of touchedCampaigns) {
    const { count: remaining } = await admin
      .from("wa_template_sends")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "queued");

    if ((remaining ?? 0) === 0) {
      const { count: sent } = await admin
        .from("wa_template_sends")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "sent");

      await admin
        .from("campaigns")
        .update({
          status: "completed",
          total_sent: sent ?? 0,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
      summary.campaignsCompleted++;
    } else {
      // Atualiza contador parcial.
      const { count: sentSoFar } = await admin
        .from("wa_template_sends")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "sent");
      await admin
        .from("campaigns")
        .update({ total_sent: sentSoFar ?? 0, updated_at: new Date().toISOString() })
        .eq("id", campaignId);
    }
  }

  return NextResponse.json({ ok: true, ...summary, timestamp: new Date().toISOString() });
}
