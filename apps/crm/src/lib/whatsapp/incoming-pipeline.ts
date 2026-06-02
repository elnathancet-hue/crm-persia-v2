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
import { OPEN_CONVERSATION_STATUSES } from "@persia/shared/crm";
import { phoneBR } from "@persia/shared/validation";
import { revalidateLeadAndChatCaches } from "@/lib/cache/lead-revalidation";
import { getAndCacheContactAvatar } from "@/lib/lead-avatar-cache";
import { handleInboundReplyForCampaigns } from "@/lib/campaigns/stop-on-reply";

export interface IncomingContext {
  supabase: SupabaseClient;
  orgId: string;
  provider: WhatsAppProvider;
  msg: IncomingMessage;
  requestId?: string;
}

/**
 * Backlog #9 Auditoria (mai/2026): rodada 5 #media.
 *
 * Timeout para a chamada n8n no caminho LEGACY (`processIncomingMessage`).
 * Sem isso, a Meta retransmite o webhook quando n8n leva 30-60s, gerando
 * duplicidade de inserts em `agent_conversations` e respostas duplicadas
 * pro lead. Meta espera ~20s antes do primeiro retry; 8s deixa folga
 * pra todo o resto do pipeline (lead create + dispatch + provider send)
 * caber dentro do envelope da resposta HTTP do webhook.
 *
 * Curto prazo conforme a recomendacao do plano. Medio prazo (nao
 * implementado ainda): mover envelope cru pra `incoming_webhook_events`
 * + worker assincrono, retornando 200 imediatamente apos validar HMAC.
 */
const N8N_FETCH_TIMEOUT_MS = 8_000;

/**
 * Wrap `fetch` com AbortController + timeout. Re-lanca o erro original
 * (incluindo DOMException de abort) pro caller distinguir AbortError de
 * falhas HTTP/network — ver `isAbortError()`.
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * AbortController.abort() em Node 18+ lanca DOMException com name="AbortError".
 * Em alguns runtimes (older undici, bun) aparece como Error com mesmo name.
 * Cobrimos ambos.
 */
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
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
    // Bug E fix (mai/2026): mesma race do Bug C, em leads. 2 msgs do mesmo
    // phone chegando em <100ms via webhook UAZAPI passam o SELECT vazio e
    // tentam INSERT. UNIQUE partial (migration 010, org+phone WHERE phone
    // NOT NULL) dispara 23505 no perdedor. Sem try-catch, .single() joga,
    // lead vira null e a mensagem é silenciosamente perdida.
    const { data: newLead, error: leadErr } = await supabase
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
    if (leadErr && leadErr.code === "23505") {
      // Race lost — re-SELECT o lead que o vencedor criou.
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("organization_id", orgId)
        .eq("phone", normalizedPhone)
        .maybeSingle();
      lead = existingLead;
      // isNewLead fica false — outro processo já disparou os triggers
      // de novo-lead. Evitamos duplicar webhook lead.created + onNewLead.
    } else if (leadErr) {
      logError("incoming_pipeline_lead_create_failed", {
        ...baseLogContext,
        phone: normalizedPhone,
        error: leadErr.message,
        code: leadErr.code,
      });
    } else {
      lead = newLead;
      isNewLead = true;
    }

    if (lead && isNewLead) {
      await supabase.from("lead_activities").insert({
        organization_id: orgId,
        lead_id: lead.id,
        type: "lead_created",
        description: `Lead criado via WhatsApp (${msg.pushName || normalizedPhone})`,
      });
      // Etapa 2: busca foto WhatsApp em background usando serviço único.
      // getAndCacheContactAvatar já persiste leads.avatar_url internamente.
      void getAndCacheContactAvatar({
        organizationId: orgId,
        leadId: lead.id,
        phone: normalizedPhone,
        provider,
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
  //
  // Bug C fix (mai/2026): race entre 2 mensagens do mesmo lead chegando
  // em <100ms via webhook pode fazer ambas verem `null` no SELECT e
  // tentarem INSERT. UNIQUE partial index (migration 063) garante DB-level
  // que só existe 1 conv (active|waiting_human) por (org, lead). Aqui
  // detectamos o 23505 do perdedor da race e re-SELECT a conv que o
  // vencedor acabou de criar.
  let { data: conversation } = await supabase
    .from("conversations")
    .select("id, assigned_to, status")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id)
    .in("status", [...OPEN_CONVERSATION_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: newConv, error: convErr } = await supabase
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
    if (convErr && convErr.code === "23505") {
      // Race lost — outra request criou a conv ativa antes. Re-SELECT.
      const { data: existingConv } = await supabase
        .from("conversations")
        .select("id, assigned_to, status")
        .eq("organization_id", orgId)
        .eq("lead_id", lead.id)
        .in("status", [...OPEN_CONVERSATION_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      conversation = existingConv;
    } else if (convErr) {
      logError("incoming_pipeline_conv_create_failed", {
        ...baseLogContext,
        lead_id: lead.id,
        error: convErr.message,
        code: convErr.code,
      });
    } else {
      conversation = newConv;
    }
  }

  if (!conversation) return { ok: false, error: "failed to create conversation" };

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  // 6) Save incoming message
  //
  // Cleanup (mai/2026): `status: "delivered"` explícito pra alinhar com
  // o caminho do executor.ts (AI Agent nativo). Mesma msg via dois
  // caminhos vinha com status divergente — dashboards/contadores
  // mostravam números diferentes. Inbound já chegou no servidor por
  // definição, então "delivered" é correto invariante-wise.
  //
  // Bug H fix (mai/2026): try-catch 23505 pra cobrir race do dedup.
  // Webhook UAZAPI faz retry/replay — 2 chamadas paralelas passam
  // o SELECT dedup vazio e tentam INSERT. UNIQUE(org, whatsapp_msg_id)
  // da migration 064 catcha o segundo. Sem este try-catch, o throw
  // do segundo INSERT mata o request e o usuário não recebe resposta.
  const { error: msgInsertErr } = await supabase.from("messages").insert({
    organization_id: orgId,
    conversation_id: conversation.id,
    lead_id: lead.id,
    content: msg.text,
    sender: "lead",
    type: msg.type,
    whatsapp_msg_id: msg.messageId,
    media_url: msg.mediaUrl || null,
    media_type: msg.mediaMimeType || null,
    status: "delivered",
  });
  if (msgInsertErr && msgInsertErr.code !== "23505") {
    // 23505 = race do dedup (já temos a msg, OK ignorar)
    // Outros erros são reais (RLS, schema, etc) — propaga.
    logError("incoming_pipeline_msg_insert_failed", {
      ...baseLogContext,
      lead_id: lead.id,
      conversation_id: conversation.id,
      error: msgInsertErr.message,
      code: msgInsertErr.code,
    });
  }

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

  // Stop-on-reply de campanhas: best-effort, nunca bloqueia pipeline.
  void handleInboundReplyForCampaigns({
    supabase: ctx.supabase,
    orgId,
    leadId: lead.id,
    conversationId: conversation.id,
    isGroup: false,
  });

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

      // PR-K-CENTRIC (mai/2026): contexto enviado ao n8n agora vem do
      // LEAD direto (lead.pipeline_id + lead.stage_id), nao mais do
      // deal mais recente. 1 query, sem JOIN, sem ambiguidade.
      // Compat: campos dealId/dealValue mantidos no payload do n8n,
      // mas agora ficam null/0 (n8n flows que ainda os consomem
      // continuam funcionando — null/0 e degradação graciosa).
      let leadContext: {
        stage?: string;
        pipeline?: string;
        pipelineId?: string;
        expectedValue?: number;
      } = {};
      let leadTags: string[] = [];
      let leadStatus: string | null = null;
      let assistantPrompt: string | null = null;
      let assistantTone: string | null = null;
      let funnelStages: { name: string; description: string | null; sort_order: number }[] = [];

      try {
        const [leadCtxRes, tagsRes, assistantRes] = await Promise.all([
          supabase
            .from("leads")
            .select(
              "status, pipeline_id, stage_id, expected_value, pipeline_stages(name), pipelines(name)",
            )
            .eq("id", lead.id)
            .maybeSingle(),
          supabase.from("lead_tags").select("tags(name)").eq("lead_id", lead.id),
          supabase
            .from("ai_assistants")
            .select("prompt, tone")
            .eq("organization_id", orgId)
            .eq("is_active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        ]);

        if (leadCtxRes.data) {
          const l = leadCtxRes.data as Record<string, unknown>;
          leadContext = {
            stage: (l.pipeline_stages as Record<string, unknown>)?.name as string | undefined,
            pipeline: (l.pipelines as Record<string, unknown>)?.name as string | undefined,
            pipelineId: l.pipeline_id as string | undefined,
            expectedValue: l.expected_value as number | undefined,
          };
          leadStatus = (l.status as string | undefined) || null;
        }
        leadTags = (tagsRes.data || [])
          .map((t: Record<string, unknown>) => (t.tags as Record<string, unknown>)?.name as string)
          .filter(Boolean);
        assistantPrompt = (assistantRes.data as { prompt?: string } | null)?.prompt || null;
        assistantTone = (assistantRes.data as { tone?: string } | null)?.tone || null;

        const pipelineId = leadContext.pipelineId;
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
      } catch (err: unknown) {
        // Cleanup (mai/2026): catch mudo apagava erros silenciosos no load
        // do contexto de pipeline/stages. Org com schema corrompido
        // mandava payload n8n vazio sem trace. Mantemos best-effort
        // (não interrompe) mas com log pra Sentry/observability.
        logError("incoming_pipeline_context_load_failed", {
          ...baseLogContext,
          lead_id: lead.id,
          error: errorMessage(err),
        });
      }

      const aiContext = (orgSettings.ai_context || {}) as Record<string, string>;

      // Backlog #9: usa fetchWithTimeout (8s) em vez de fetch direto.
      // Sem timeout, n8n lento -> Meta retransmite -> duplicidade no
      // pipeline nativo. O caller (catch abaixo) distingue AbortError
      // pra logar como timeout especifico em vez de erro generico.
      const n8nResponse = await fetchWithTimeout(n8nWebhookUrl, {
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
          // PR-K-CENTRIC: campos vêm do lead (não mais do deal aberto).
          // dealId/dealValue mantidos como null/0 pra retrocompat com
          // flows n8n existentes — quando o flow precisar de deal especifico,
          // usar a action /api/crm get_deal pra resolver.
          currentStage: leadContext.stage || null,
          currentPipeline: leadContext.pipeline || null,
          dealId: null,
          dealValue: leadContext.expectedValue ?? null,
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
      }, N8N_FETCH_TIMEOUT_MS);

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
      // Backlog #9: distingue timeout (AbortController) de erros genericos
      // pra observability — timeout indica n8n lento (recomenda subir
      // capacidade ou ajustar workflow), erro generico indica problema
      // de rede/auth/payload. Mesmo handling (cair pro OpenAI fallback)
      // mas log estruturado diferente.
      if (isAbortError(err)) {
        logError("incoming_pipeline_n8n_timeout", {
          ...baseLogContext,
          lead_id: lead.id,
          conversation_id: conversation.id,
          timeout_ms: N8N_FETCH_TIMEOUT_MS,
        });
      } else {
        logError("incoming_pipeline_n8n_call_failed", {
          ...baseLogContext,
          lead_id: lead.id,
          conversation_id: conversation.id,
          error: errorMessage(err),
        });
      }
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
