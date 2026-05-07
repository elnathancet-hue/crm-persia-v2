/**
 * Shared incoming-message pipeline.
 *
 * Called by both UAZAPI webhook (`/api/whatsapp/webhook`) and Meta Cloud webhook
 * (`/api/whatsapp/webhook/meta/[phone_number_id]`) after each webhook has:
 *   1) matched the organization's WhatsApp connection,
 *   2) parsed the raw payload into a normalized `IncomingMessage`,
 *   3) resolved `mediaUrl`/`mediaMimeType` if applicable,
 * — so this helper is entirely provider-agnostic.
 *
 * Responsibilities (in order):
 *   - dedup by `whatsapp_msg_id`
 *   - find/create lead + activity log + webhook.lead.created + flows.onNewLead
 *   - flows.onKeyword (bypasses AI if it matches)
 *   - find/create conversation + bump last_message_at
 *   - persist incoming message + webhook.message.received
 *   - if conversation.assigned_to === "ai": run n8n (preferred) or OpenAI fallback
 *     → split response, insert outgoing messages, send via provider, markAsRead
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage, WhatsAppProvider } from "@/lib/whatsapp/provider";
import { onKeyword, onNewLead } from "@/lib/flows/triggers";
import { parseSplitConfig, splitMessage } from "@/lib/ai/message-splitter";
import { dispatchWebhook } from "@/lib/webhooks/dispatcher";
import { errorMessage, logError } from "@/lib/observability";
import { phoneBR } from "@persia/shared/validation";
import { revalidateLeadAndChatCaches } from "@/lib/cache/lead-revalidation";

export interface IncomingContext {
  supabase: SupabaseClient;
  orgId: string;
  provider: WhatsAppProvider;
  msg: IncomingMessage;
  requestId?: string;
}

export interface IncomingResult {
  ok: boolean;
  skipped?: string;
  leadId?: string;
  conversationId?: string;
  handledBy?: "flow" | "ai_n8n" | "ai_openai" | "none";
  error?: string;
}

export async function processIncomingMessage(ctx: IncomingContext): Promise<IncomingResult> {
  const { supabase, orgId, provider, msg, requestId } = ctx;
  const baseLogContext = {
    organization_id: orgId,
    request_id: requestId ?? null,
    provider: provider.name,
    message_type: msg.type,
  };

  // 1) Dedup
  if (msg.messageId) {
    const { data: existing } = await supabase
      .from("messages")
      .select("id")
      .eq("whatsapp_msg_id", msg.messageId)
      .limit(1)
      .maybeSingle();
    if (existing) return { ok: true, skipped: "duplicate message" };
  }

  // Skip if no text AND no media
  if (!msg.text && !msg.mediaUrl) {
    return { ok: true, skipped: "no text or media" };
  }

  // 2) Find or create lead
  //
  // PR-A LEADFIX: phone normalizado via Zod (E.164) antes de
  // lookup/insert. Garante que webhook UAZAPI nao gera leads
  // duplicados por variacao de formato (ex: "11987654321" vs
  // "+5511987654321"). Tolerante a falha — se phone vier malformado,
  // skipa a normalizacao e usa o raw (degradacao).
  let normalizedPhone = msg.phone;
  try {
    normalizedPhone = phoneBR.parse(msg.phone);
  } catch {
    // Phone invalido vindo do webhook (raro). Loga e segue com raw —
    // melhor ter lead com phone estranho do que perder a mensagem.
    logError("incoming_pipeline_phone_normalize_failed", {
      ...baseLogContext,
      raw_phone: msg.phone,
    });
  }

  let isNewLead = false;
  let { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (!lead) {
    const { data: newLead } = await supabase
      .from("leads")
      .insert({
        organization_id: orgId,
        phone: normalizedPhone,
        name: msg.pushName || normalizedPhone,
        source: "whatsapp",
        status: "new",
        channel: "whatsapp",
      })
      .select("id")
      .single();
    lead = newLead;
    isNewLead = true;

    if (lead) {
      await supabase.from("lead_activities").insert({
        organization_id: orgId,
        lead_id: lead.id,
        type: "lead_created",
        description: `Lead criado via WhatsApp (${msg.pushName || normalizedPhone})`,
      });
    }
  }

  if (!lead) return { ok: false, error: "failed to create lead" };

  // 3) New-lead triggers
  if (isNewLead) {
    dispatchWebhook(orgId, "lead.created", {
      lead: { id: lead.id, phone: normalizedPhone, name: msg.pushName },
    });
    try {
      await onNewLead(orgId, lead.id);
    } catch (err: unknown) {
      logError("incoming_pipeline_on_new_lead_failed", {
        ...baseLogContext,
        lead_id: lead.id,
        error: errorMessage(err),
      });
    }

    // PR-A LEADFIX: auto-deal removido daqui. Migration 035 instala
    // trigger DB `lead_auto_deal` que cria deal pra TODO lead inserido
    // (qualquer caminho). Defense-in-depth no DB e mais robusta que
    // fire-and-forget na camada de aplicacao — funciona ate pra
    // INSERTs feitos via Supabase Studio direto.
  }

  // 4) Keyword triggers (before AI)
  let keywordFlowTriggered = false;
  try {
    keywordFlowTriggered = await onKeyword(orgId, lead.id, msg.text || "");
  } catch (err: unknown) {
    logError("incoming_pipeline_on_keyword_failed", {
      ...baseLogContext,
      lead_id: lead.id,
      error: errorMessage(err),
    });
  }

  // 5) Find or create conversation
  let { data: conversation } = await supabase
    .from("conversations")
    .select("id, assigned_to, status")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id)
    .in("status", ["active", "waiting_human"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: newConv } = await supabase
      .from("conversations")
      .insert({
        organization_id: orgId,
        lead_id: lead.id,
        channel: "whatsapp",
        status: "active",
        assigned_to: "ai",
        last_message_at: new Date().toISOString(),
      })
      .select("id, assigned_to, status")
      .single();
    conversation = newConv;
  }

  if (!conversation) return { ok: false, error: "failed to create conversation" };

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  // 6) Save incoming message
  await supabase.from("messages").insert({
    organization_id: orgId,
    conversation_id: conversation.id,
    lead_id: lead.id,
    content: msg.text,
    sender: "lead",
    type: msg.type,
    whatsapp_msg_id: msg.messageId,
    media_url: msg.mediaUrl || null,
    media_type: msg.mediaMimeType || null,
  });

  dispatchWebhook(orgId, "message.received", {
    conversationId: conversation.id,
    leadId: lead.id,
    phone: msg.phone,
    content: msg.text,
    type: msg.type,
  });

  // PR-K LEAD-SYNC: invalida caches /crm + /leads + /chat apos
  // pipeline completo (lead + conversation + message persistidos).
  // Helper e tolerante a falha — try/catch interno garante que
  // mensagem do WhatsApp NUNCA falha por erro de revalidate.
  // Lead novo aparece na tab Leads na proxima navegacao do agente
  // (95% dos casos). User parado na tab so ve com Realtime/PR-O.
  await revalidateLeadAndChatCaches(lead.id);

  // 7) Flow already handled it?
  if (keywordFlowTriggered) {
    return {
      ok: true,
      leadId: lead.id,
      conversationId: conversation.id,
      handledBy: "flow",
    };
  }

  // 8) If assigned to AI, run n8n or OpenAI fallback
  if (conversation.assigned_to !== "ai") {
    return {
      ok: true,
      leadId: lead.id,
      conversationId: conversation.id,
      handledBy: "none",
    };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, niche, settings")
    .eq("id", orgId)
    .single();

  const orgSettings = (org?.settings || {}) as Record<string, unknown>;
  const n8nWebhookUrl =
    (orgSettings.n8n_webhook_url as string) ||
    process.env.N8N_WEBHOOK_URL ||
    null;

  // --- MODE 1: n8n (preferred) ---
  if (n8nWebhookUrl) {
    try {
      await provider.setTyping(msg.phone, true).catch(() => {});

      let dealContext: {
        stage?: string;
        pipeline?: string;
        pipelineId?: string;
        dealId?: string;
        dealValue?: number;
      } = {};
      let leadTags: string[] = [];
      let leadStatus: string | null = null;
      let assistantPrompt: string | null = null;
      let assistantTone: string | null = null;
      let funnelStages: { name: string; description: string | null; sort_order: number }[] = [];

      try {
        const [dealRes, tagsRes, leadRes, assistantRes] = await Promise.all([
          supabase
            .from("deals")
            .select("id, value, pipeline_id, pipeline_stages(name), pipelines(name)")
            .eq("lead_id", lead.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from("lead_tags").select("tags(name)").eq("lead_id", lead.id),
          supabase.from("leads").select("status").eq("id", lead.id).maybeSingle(),
          supabase
            .from("ai_assistants")
            .select("prompt, tone")
            .eq("organization_id", orgId)
            .eq("is_active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        ]);

        if (dealRes.data) {
          const d = dealRes.data as Record<string, unknown>;
          dealContext = {
            stage: (d.pipeline_stages as Record<string, unknown>)?.name as string | undefined,
            pipeline: (d.pipelines as Record<string, unknown>)?.name as string | undefined,
            pipelineId: d.pipeline_id as string | undefined,
            dealId: d.id as string | undefined,
            dealValue: d.value as number | undefined,
          };
        }
        leadTags = (tagsRes.data || [])
          .map((t: Record<string, unknown>) => (t.tags as Record<string, unknown>)?.name as string)
          .filter(Boolean);
        leadStatus = (leadRes.data as { status?: string } | null)?.status || null;
        assistantPrompt = (assistantRes.data as { prompt?: string } | null)?.prompt || null;
        assistantTone = (assistantRes.data as { tone?: string } | null)?.tone || null;

        const pipelineId = dealContext.pipelineId;
        if (pipelineId) {
          const { data: stages } = await supabase
            .from("pipeline_stages")
            .select("name, description, sort_order")
            .eq("pipeline_id", pipelineId)
            .order("sort_order", { ascending: true });
          funnelStages = (stages || []).map((s: Record<string, unknown>) => ({
            name: s.name as string,
            description: (s.description as string | null) || null,
            sort_order: s.sort_order as number,
          }));
        } else {
          const { data: firstPipeline } = await supabase
            .from("pipelines")
            .select("id")
            .eq("organization_id", orgId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (firstPipeline) {
            const { data: stages } = await supabase
              .from("pipeline_stages")
              .select("name, description, sort_order")
              .eq("pipeline_id", (firstPipeline as { id: string }).id)
              .order("sort_order", { ascending: true });
            funnelStages = (stages || []).map((s: Record<string, unknown>) => ({
              name: s.name as string,
              description: (s.description as string | null) || null,
              sort_order: s.sort_order as number,
            }));
          }
        }
      } catch {
        /* best-effort */
      }

      const aiContext = (orgSettings.ai_context || {}) as Record<string, string>;

      const n8nResponse = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefone: msg.phone,
          identificador: `${orgId}:${lead.id}`,
          query: msg.text || "",
          leadName: msg.pushName || "",
          leadId: lead.id,
          conversationId: conversation.id,
          orgId,
          messageType: msg.type,
          mediaUrl: msg.mediaUrl || null,
          currentStage: dealContext.stage || null,
          currentPipeline: dealContext.pipeline || null,
          dealId: dealContext.dealId || null,
          dealValue: dealContext.dealValue ?? null,
          tags: leadTags,
          leadStatus,
          orgName: org?.name || null,
          assistantPrompt,
          assistantTone: assistantTone || "profissional",
          aiContext: {
            product: aiContext.product || null,
            target_audience: aiContext.target_audience || null,
            sales_goal: aiContext.sales_goal || null,
            restrictions: aiContext.restrictions || null,
            key_info: aiContext.key_info || null,
          },
          funnelStages: funnelStages.length > 0 ? funnelStages : null,
        }),
      });

      if (n8nResponse.ok) {
        const n8nData = await n8nResponse.json();
        const aiResponse =
          typeof n8nData === "string"
            ? n8nData
            : n8nData.output || n8nData.text || n8nData.response || JSON.stringify(n8nData);

        if (aiResponse && aiResponse !== "{}") {
          const { data: assistant } = await supabase
            .from("ai_assistants")
            .select("message_splitting")
            .eq("organization_id", orgId)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          const splitConfig = parseSplitConfig(
            (assistant as { message_splitting?: unknown } | null)?.message_splitting,
          );
          const parts = await splitMessage(aiResponse, splitConfig);

          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            await supabase.from("messages").insert({
              organization_id: orgId,
              conversation_id: conversation.id,
              lead_id: lead.id,
              content: part,
              sender: "ai",
              type: "text",
            });

            if (i > 0) {
              await provider.setTyping(msg.phone, true).catch(() => {});
              await new Promise((r) => setTimeout(r, splitConfig.delay_seconds * 1000));
            }

            await provider.sendText({ phone: msg.phone, message: part });
          }

          if (msg.messageId) {
            await provider.markAsRead([msg.messageId], msg.phone).catch(() => {});
          }

          return {
            ok: true,
            leadId: lead.id,
            conversationId: conversation.id,
            handledBy: "ai_n8n",
          };
        }
      } else {
        const responseText = await n8nResponse.text().catch(() => "");
        logError("incoming_pipeline_n8n_http_error", {
          ...baseLogContext,
          lead_id: lead.id,
          conversation_id: conversation.id,
          status: n8nResponse.status,
          response_body_length: responseText.length,
        });
      }
    } catch (err: unknown) {
      logError("incoming_pipeline_n8n_call_failed", {
        ...baseLogContext,
        lead_id: lead.id,
        conversation_id: conversation.id,
        error: errorMessage(err),
      });
    }
  }

  // --- MODE 2: Internal OpenAI ---
  const { data: assistant } = await supabase
    .from("ai_assistants")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (assistant && process.env.OPENAI_API_KEY) {
    try {
      const { processMessage, calculateTypingDelay } = await import("@/lib/ai/chat-engine");
      const a = assistant as Record<string, unknown>;
      const mediaInfo = msg.mediaUrl
        ? { type: msg.type, url: msg.mediaUrl }
        : undefined;
      const result = await processMessage(
        a.id as string,
        conversation.id,
        msg.text || "",
        mediaInfo,
      );

      const splitConfig = parseSplitConfig(a.message_splitting);
      let messagesToSend: string[];
      if (splitConfig.enabled) {
        messagesToSend = await splitMessage(result.response, splitConfig);
      } else {
        messagesToSend = result.splitMessages || [result.response];
      }

      for (let i = 0; i < messagesToSend.length; i++) {
        const part = messagesToSend[i];

        await provider.setTyping(msg.phone, true).catch(() => {});
        const delay = splitConfig.enabled
          ? splitConfig.delay_seconds
          : calculateTypingDelay(part, (a.typing_delay_seconds as number) || 3);
        await new Promise((resolve) => setTimeout(resolve, delay * 1000));

        await supabase.from("messages").insert({
          organization_id: orgId,
          conversation_id: conversation.id,
          lead_id: lead.id,
          content: part,
          sender: "ai",
          type: "text",
        });

        await provider.sendText({ phone: msg.phone, message: part });
      }

      if (msg.messageId) {
        await provider.markAsRead([msg.messageId], msg.phone).catch(() => {});
      }

      return {
        ok: true,
        leadId: lead.id,
        conversationId: conversation.id,
        handledBy: "ai_openai",
      };
    } catch (err: unknown) {
      logError("incoming_pipeline_openai_failed", {
        ...baseLogContext,
        lead_id: lead.id,
        conversation_id: conversation.id,
        error: errorMessage(err),
      });
    }
  }

  return {
    ok: true,
    leadId: lead.id,
    conversationId: conversation.id,
    handledBy: "none",
  };
}
