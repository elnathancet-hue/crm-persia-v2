// AI Agent — webhook entry point + debounce flush executor.
//
// PR-FLOW-PIVOT PR 2b (mai/2026): substitui o stub do PR 1. Agora o
// webhook WhatsApp encaminha mensagens reais pro flow runtime via
// pending_messages + cron flush, em vez de cair no pipeline legacy
// n8n/OpenAI.
//
// Fluxo:
//   webhook → tryEnqueueForNativeAgent
//     ├─ check feature flag native_agent_enabled
//     ├─ resolve agent_config primário da org
//     ├─ find/create lead + conversation + message
//     ├─ find/create agent_conversation (current_node_id=null inicialmente)
//     ├─ enqueue pending_message via RPC + bump next_flush_at
//     └─ return {handled: true} → webhook NÃO chama pipeline legacy
//
//   cron /api/ai-agent/debounce-flush → flushReadyConversations
//     ├─ SELECT agent_conversations onde next_flush_at <= now
//     ├─ claimConversation (lock 120s)
//     ├─ loadPendingMessages → concatena num batch
//     ├─ executeDebouncedBatch → runFlow real com provider WhatsApp
//     └─ completeConversation → mark flushed_at + reset lock
//
// Limitações V1 (documentadas):
//   - Não dispara flows.onNewLead / flows.onKeyword (legacy-only).
//   - Sem agent_runs.tokens_input/output audit ainda (PR 6).
//   - Sem RAG injection, sem history_summary, sem humanization split.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@persia/shared";
import { OPEN_CONVERSATION_STATUSES } from "@persia/shared/crm";
import type { IncomingMessage, WhatsAppProvider } from "@persia/shared/whatsapp";
import { createProvider } from "@persia/shared/providers";
import { phoneBR } from "@persia/shared/validation";
import {
  NATIVE_AGENT_FEATURE_FLAG,
  calculateCostUsdCents,
  findEntryNode,
  isAutoPauseExpired,
  isWithinBusinessHours,
  matchesPauseKeyword,
  matchesResumeKeyword,
  normalizeHumanizationConfig,
  shouldSendAfterHoursMessage,
  shouldTriggerFlowFromInbound,
  type DebounceFlushBatch,
  type OrganizationSettings,
} from "@persia/shared/ai-agent";
import { errorMessage, logError } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "./db";
import { loadFlowByConfigId } from "./flow/loader";
import { createRealtimeProvider } from "./flow/realtime-provider";
import { runFlow } from "./flow/runner";
import type { FlowRunContext } from "./flow/types";
import { sendAssistantReply } from "./send-reply";

// ============================================================================
// Tipos públicos (mesmo shape do stub — compatíveis com webhook+debounce)
// ============================================================================

export interface NativeAgentResponseShape {
  ok?: boolean;
  skipped?: string;
  handledBy?: string;
  leadId?: string | null;
  conversationId?: string | null;
  status?: string;
  runId?: string;
}

export interface TryEnqueueOutcome {
  handled: boolean;
  response: NativeAgentResponseShape;
}

export interface TryEnqueueInput {
  supabase: SupabaseClient<Database>;
  orgId: string;
  provider: WhatsAppProvider;
  msg: IncomingMessage;
  requestId: string;
}

function normalizeInboundMessageContent(msg: IncomingMessage): string | null {
  const text = msg.text?.trim();
  if (text) return text;
  const caption = msg.caption?.trim();
  if (caption) return caption;
  return null;
}

async function resolveAgentNewLeadStage(
  db: AgentDb,
  orgId: string,
  stageId: string | null | undefined,
): Promise<{ id: string; pipeline_id: string } | null> {
  if (!stageId) return null;
  const { data, error } = await db
    .from("pipeline_stages")
    .select("id, pipeline_id")
    .eq("organization_id", orgId)
    .eq("id", stageId)
    .maybeSingle();
  if (error || !data) {
    logError("ai_agent_new_lead_stage_resolve_failed", {
      organization_id: orgId,
      stage_id: stageId,
      error: error?.message ?? "stage_not_found",
    });
    return null;
  }
  return data as { id: string; pipeline_id: string };
}

function buildInboundTextForAgent(msg: IncomingMessage): string | null {
  const content = normalizeInboundMessageContent(msg);
  if (content) return content;
  if (!msg.mediaUrl) return null;

  switch (msg.type) {
    case "image":
      return "[imagem recebida] O lead enviou uma imagem.";
    case "audio":
      return "[audio recebido] O lead enviou um audio.";
    case "video":
      return "[video recebido] O lead enviou um video.";
    case "document":
      return "[documento recebido] O lead enviou um documento.";
    case "location":
      return "[localizacao recebida] O lead enviou uma localizacao.";
    case "contact":
      return "[contato recebido] O lead enviou um contato.";
    case "sticker":
      return "[figurinha recebida] O lead enviou uma figurinha.";
    default:
      return "[midia recebida] O lead enviou uma midia.";
  }
}

function normalizePendingMessageType(msg: IncomingMessage): string {
  if (
    msg.type === "text" ||
    msg.type === "image" ||
    msg.type === "audio" ||
    msg.type === "video" ||
    msg.type === "document" ||
    msg.type === "location"
  ) {
    return msg.type;
  }
  return "other";
}

// ============================================================================
// tryEnqueueForNativeAgent — entry point do webhook
// ============================================================================

const DEBOUNCE_WINDOW_MS_DEFAULT = 10_000;

export async function tryEnqueueForNativeAgent(
  input: TryEnqueueInput,
): Promise<TryEnqueueOutcome> {
  const { supabase, orgId, msg, requestId } = input;
  const db = asAgentDb(supabase);
  const logCtx = {
    organization_id: orgId,
    request_id: requestId,
    provider: input.provider.name,
  };

  // 1. Feature flag por org. Default OFF — orgs que não optaram caem
  // no pipeline legacy.
  const { data: orgRow } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  const settings = (orgRow as { settings?: OrganizationSettings } | null)
    ?.settings;
  if (!settings?.features?.[NATIVE_AGENT_FEATURE_FLAG]) {
    return {
      handled: false,
      response: { ok: false, skipped: "native_agent_disabled" },
    };
  }

  // 2. Resolve agent primário da org. Sem primary → cai pra legacy.
  const { data: primaryRow } = await db
    .from("agent_configs")
    .select("id, debounce_window_ms, humanization_config, new_lead_stage_id")
    .eq("organization_id", orgId)
    .eq("is_primary", true)
    .eq("status", "active")
    .maybeSingle();
  if (!primaryRow) {
    return {
      handled: false,
      response: { ok: false, skipped: "no_primary_agent" },
    };
  }
  const agentConfigId = (primaryRow as { id: string }).id;
  const debounceWindowMs =
    (primaryRow as { debounce_window_ms?: number | null }).debounce_window_ms ??
    DEBOUNCE_WINDOW_MS_DEFAULT;
  const humanization = normalizeHumanizationConfig(
    (primaryRow as { humanization_config?: unknown }).humanization_config,
  );
  const newLeadStage = await resolveAgentNewLeadStage(
    db,
    orgId,
    (primaryRow as { new_lead_stage_id?: string | null }).new_lead_stage_id,
  );
  const inboundText = buildInboundTextForAgent(msg);
  const messageContent = normalizeInboundMessageContent(msg);

  // 3. Skip apenas payload realmente vazio. Midia-only entra com uma
  // descricao curta no contexto do agente, mas continua persistindo a midia.
  if (!inboundText) {
    return {
      handled: false,
      response: { ok: false, skipped: "empty_message" },
    };
  }

  try {
    // 4. Phone normalizado (mesma lógica da pipeline legacy).
    let phone = msg.phone;
    try {
      phone = phoneBR.parse(msg.phone);
    } catch {
      // Phone malformado — segue com raw (defensive).
    }

    // 5. Dedup: se a msg já foi processada (whatsapp_msg_id), skip silencioso.
    if (msg.messageId) {
      const { data: existing } = await db
        .from("messages")
        .select("id")
        .eq("whatsapp_msg_id", msg.messageId)
        .limit(1)
        .maybeSingle();
      if (existing) {
        return {
          handled: true,
          response: { ok: true, skipped: "duplicate_message", handledBy: "ai_native" },
        };
      }
    }

    // 6. Find/create lead.
    let { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("organization_id", orgId)
      .eq("phone", phone)
      .maybeSingle();
    if (!lead) {
      const { data: newLead, error: leadErr } = await db
        .from("leads")
        .insert({
          organization_id: orgId,
          phone,
          name: msg.pushName ?? phone,
          source: "whatsapp",
          status: "new",
          channel: "whatsapp",
          pipeline_id: newLeadStage?.pipeline_id ?? null,
          stage_id: newLeadStage?.id ?? null,
        })
        .select("id")
        .single();
      if (leadErr || !newLead) {
        throw new Error(`lead_create_failed: ${leadErr?.message ?? "unknown"}`);
      }
      lead = newLead;
      // Bug A fix (mai/2026): busca foto WhatsApp em background.
      // Não bloqueia o pipeline — se UAZAPI falhar, lead fica sem
      // avatar e UI cai no fallback de iniciais. Rodamos só uma vez
      // (na criação do lead) pra evitar rate limit em /chat/details.
      const newLeadId = newLead.id;
      void (async () => {
        try {
          const avatarUrl = await input.provider.getContactProfilePic(phone);
          if (avatarUrl) {
            await db
              .from("leads")
              .update({ avatar_url: avatarUrl })
              .eq("id", newLeadId);
          }
        } catch {
          // Best-effort — falha não interrompe atendimento.
        }
      })();
    }
    const leadId = (lead as { id: string }).id;

    // 7. Find/create conversation com assigned_to=ai (sinaliza pro
    // chat-window que a IA está no controle).
    //
    // Bug C fix (mai/2026): race entre 2 mensagens do mesmo lead
    // chegando em <100ms via webhook pode fazer ambas verem `null` no
    // SELECT e tentarem INSERT. UNIQUE partial index (migration 063)
    // garante DB-level que só existe 1 conv (active|waiting_human) por
    // (org, lead). Aqui detectamos o 23505 do perdedor da race e
    // re-SELECT a conv que o vencedor acabou de criar.
    let { data: conv } = await db
      .from("conversations")
      .select("id, assigned_to, status")
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .in("status", [...OPEN_CONVERSATION_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conv) {
      const { data: newConv, error: convErr } = await db
        .from("conversations")
        .insert({
          organization_id: orgId,
          lead_id: leadId,
          channel: "whatsapp",
          status: "active",
          assigned_to: "ai",
          last_message_at: new Date().toISOString(),
        })
        .select("id, assigned_to, status")
        .single();
      if (convErr) {
        if (convErr.code === "23505") {
          // Race lost — outra request criou a conv ativa antes de nós.
          // Re-SELECT (mesmo filtro do passo anterior) pra pegar o id
          // da conv vencedora e seguir o fluxo normal.
          const { data: existingConv, error: refetchErr } = await db
            .from("conversations")
            .select("id, assigned_to, status")
            .eq("organization_id", orgId)
            .eq("lead_id", leadId)
            .in("status", [...OPEN_CONVERSATION_STATUSES])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (refetchErr || !existingConv) {
            throw new Error(
              `conv_race_refetch_failed: ${refetchErr?.message ?? "no_conv_after_23505"}`,
            );
          }
          conv = existingConv;
        } else {
          throw new Error(`conv_create_failed: ${convErr.message}`);
        }
      } else if (!newConv) {
        throw new Error("conv_create_failed: insert_returned_no_row");
      } else {
        conv = newConv;
      }
    } else {
      // Atualiza last_message_at + assigned_to (se humano voltou pra IA via
      // unpause, etc — V1 só seta active sem mexer em handoff).
      await db
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", (conv as { id: string }).id);
    }
    const conversation = conv as {
      id: string;
      assigned_to?: string | null;
      status?: string | null;
    };
    const conversationId = conversation.id;

    // 8. Insert inbound message em `messages` (sender='lead'). Pegamos
    // o `id` retornado pra linkar em pending_messages.inbound_message_id.
    //
    // Bug H fix (mai/2026): try-catch 23505 pra cobrir race do dedup.
    // UNIQUE(org, whatsapp_msg_id) da migration 064 catcha webhook retry.
    // Se race: re-SELECT a msg vencedora pelo whatsapp_msg_id e continua.
    let { data: msgRow, error: msgErr } = await db
      .from("messages")
      .insert({
        organization_id: orgId,
        conversation_id: conversationId,
        lead_id: leadId,
        content: messageContent,
        sender: "lead",
        type: msg.type ?? "text",
        whatsapp_msg_id: msg.messageId ?? null,
        media_url: msg.mediaUrl ?? null,
        media_type: msg.mediaMimeType ?? null,
        status: "delivered",
      })
      .select("id")
      .single();
    if (msgErr?.code === "23505" && msg.messageId) {
      // Race lost — outro processo já inseriu a msg. Re-SELECT pelo whatsapp_msg_id.
      const { data: existingMsg } = await db
        .from("messages")
        .select("id")
        .eq("organization_id", orgId)
        .eq("whatsapp_msg_id", msg.messageId)
        .maybeSingle();
      if (!existingMsg) {
        throw new Error(`message_race_refetch_failed: whatsapp_msg_id=${msg.messageId}`);
      }
      msgRow = existingMsg;
      msgErr = null;
    } else if (msgErr || !msgRow) {
      throw new Error(`message_insert_failed: ${msgErr?.message ?? "unknown"}`);
    }
    const inboundMessageId = (msgRow as { id: string }).id;

    // Human takeover guard: keep the new lead message in the CRM history,
    // but never spin up or resume the native AI runtime for human-owned chats.
    if (conversation.assigned_to !== "ai" || conversation.status !== "active") {
      return {
        handled: true,
        response: {
          ok: true,
          handledBy: "ai_native_flow",
          leadId,
          conversationId,
          status: "human_owned_conversation",
        },
      };
    }

    // 9. Ensure agent_conversation. Idempotente por (config_id, lead_id,
    // crm_conversation_id) — não temos UNIQUE constraint mas usamos
    // find-or-create.
    let { data: agentConv } = await db
      .from("agent_conversations")
      .select("id, current_node_id, human_handoff_at, after_hours_notified_at, ai_control_epoch")
      .eq("organization_id", orgId)
      .eq("config_id", agentConfigId)
      .eq("lead_id", leadId)
      .eq("crm_conversation_id", conversationId)
      .maybeSingle();
    if (!agentConv) {
      const { data: newAgentConv, error: agentConvErr } = await db
        .from("agent_conversations")
        .insert({
          organization_id: orgId,
          config_id: agentConfigId,
          lead_id: leadId,
          crm_conversation_id: conversationId,
          current_node_id: null,
          variables: {},
          actions_executed: [],
          actions_executed_detail: {},
        })
        .select("id, current_node_id, human_handoff_at, after_hours_notified_at, ai_control_epoch")
        .single();
      if (agentConvErr || !newAgentConv) {
        throw new Error(
          `agent_conv_create_failed: ${agentConvErr?.message ?? "unknown"}`,
        );
      }
      agentConv = newAgentConv;
    }
    const agentConversationId = (agentConv as { id: string }).id;
    const humanHandoffAt = (agentConv as { human_handoff_at?: string | null })
      .human_handoff_at ?? null;
    const afterHoursNotifiedAt = (agentConv as {
      after_hours_notified_at?: string | null;
    }).after_hours_notified_at ?? null;
    const aiControlEpoch =
      (agentConv as { ai_control_epoch?: number | null }).ai_control_epoch ?? 0;

    // 9b. Humanization (PR 6, mai/2026): pause / resume keywords + auto-pause.
    //
    // Regras (avaliadas nessa ordem):
    //   a) Lead mandou resume keyword (ex: "ATIVAR") → limpa
    //      human_handoff_at + enfileira normalmente. IA volta a responder.
    //   b) Lead mandou pause keyword (ex: "PAUSAR") → seta human_handoff_at
    //      = now + SKIP enqueue. Humano assumiu.
    //   c) human_handoff_at já setado E ainda não expirou (auto_pause_minutes)
    //      → SKIP enqueue. Humano ainda no controle.
    //   d) human_handoff_at setado MAS expirou → clear + enfileira.
    //   e) Nada bate → enfileira normalmente.
    //
    // Mensagem enviada por humano via chat-window NÃO passa por aqui
    // (essa rota só processa msgs do lead). Sem necessidade de detectar
    // "humano enviou msg" pra setar auto-pause — vai num PR futuro
    // (precisa hook em send-reply.ts).
    const matchResume = matchesResumeKeyword(messageContent ?? "", humanization);
    const matchPause = matchesPauseKeyword(messageContent ?? "", humanization);

    if (matchResume) {
      await db
        .from("agent_conversations")
        .update({ human_handoff_at: null, human_handoff_reason: null })
        .eq("organization_id", orgId)
        .eq("id", agentConversationId);
    } else if (matchPause) {
      await db
        .from("agent_conversations")
        .update({
          human_handoff_at: new Date().toISOString(),
          human_handoff_reason: "pause_keyword",
        })
        .eq("organization_id", orgId)
        .eq("id", agentConversationId);
      return {
        handled: true,
        response: {
          ok: true,
          handledBy: "ai_native_flow",
          leadId,
          conversationId,
          status: "paused_by_keyword",
        },
      };
    } else if (humanHandoffAt) {
      const expired = isAutoPauseExpired(humanHandoffAt, humanization);
      if (!expired) {
        return {
          handled: true,
          response: {
            ok: true,
            handledBy: "ai_native_flow",
            leadId,
            conversationId,
            status: "paused_active",
          },
        };
      }
      // expirou → clear + segue
      await db
        .from("agent_conversations")
        .update({ human_handoff_at: null, human_handoff_reason: null })
        .eq("organization_id", orgId)
        .eq("id", agentConversationId);
    }

    // 9c. Business hours: fora do horario comercial nao roda o flow; envia
    // after_hours_message no maximo 1x por cooldown pra nao spammar o lead.
    if (humanization.business_hours_enabled) {
      const inBusinessHours = isWithinBusinessHours(
        new Date(),
        humanization.business_hours,
        humanization.business_hours_timezone,
      );
      if (!inBusinessHours) {
        if (shouldSendAfterHoursMessage(afterHoursNotifiedAt)) {
          try {
            const sendResult = await sendAssistantReply({
              provider: input.provider,
              phone,
              text: humanization.after_hours_message,
              humanization,
              orgId,
              conversationId,
              persist: { db, leadId },
              sendGuard: {
                db,
                organizationId: orgId,
                conversationId,
                agentConversationId,
                expectedControlEpoch: aiControlEpoch,
              },
            });
            if (sendResult.sent) {
              await db
                .from("agent_conversations")
                .update({ after_hours_notified_at: new Date().toISOString() })
                .eq("organization_id", orgId)
                .eq("id", agentConversationId);
            }
          } catch (err: unknown) {
            // Provider falhou, mas o webhook continua handled=true para nao
            // cair no pipeline legado e responder fora do horario.
            logError("ai_agent_after_hours_message_failed", {
              ...logCtx,
              lead_id: leadId,
              conversation_id: conversationId,
              agent_conversation_id: agentConversationId,
              error: errorMessage(err),
            });
          }
        }
        return {
          handled: true,
          response: {
            ok: true,
            handledBy: "ai_native_flow",
            leadId,
            conversationId,
            status: "after_hours",
          },
        };
      }
    }

    // 9d. Entry trigger gate (PR-FLOW-PIVOT PR 10, mai/2026).
    //
    // Antes do enqueue, checa se o flow desse agente declara um entry
    // trigger que escuta inbound message. Tipos:
    //   - conversation_started: sempre passa
    //   - keyword_match: passa se texto contém alguma keyword
    //   - segment_entered / pipeline_stage_entered: NUNCA passa por
    //     inbound (esses eventos vêm de hooks do CRM, não do webhook)
    //
    // Defensive: se flow não existir ou não tiver entry node, segue
    // como conversation_started (compat com agentes que ainda não
    // configuraram o canvas).
    try {
      const flow = await loadFlowByConfigId(db, orgId, agentConfigId);
      const entry = flow ? findEntryNode(flow.config) : null;
      if (entry && !shouldTriggerFlowFromInbound(entry, messageContent ?? "")) {
        return {
          handled: true,
          response: {
            ok: true,
            handledBy: "ai_native_flow",
            leadId,
            conversationId,
            status: `no_trigger_match:${entry.data.trigger}`,
          },
        };
      }
    } catch (err) {
      // Falha de load = log + segue (não derruba o lead por bug em flow
      // config). Pipeline cai pro default conversation_started.
      logError("native_agent_entry_trigger_check_failed", {
        ...logCtx,
        error: errorMessage(err),
      });
    }

    // 10. Enfileira em pending_messages via RPC. RPC também atualiza
    // agent_conversations.next_flush_at = received_at + debounceWindowMs.
    const { error: rpcErr } = await (db as AgentDb & {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc("enqueue_pending_message", {
      p_organization_id: orgId,
      p_agent_conversation_id: agentConversationId,
      p_debounce_window_ms: debounceWindowMs,
      p_inbound_message_id: inboundMessageId,
      p_text: inboundText,
      p_message_type: normalizePendingMessageType(msg),
      p_media_ref: msg.mediaUrl ?? null,
      p_received_at: new Date().toISOString(),
    });
    if (rpcErr) {
      throw new Error(`enqueue_failed: ${rpcErr.message}`);
    }

    return {
      handled: true,
      response: {
        ok: true,
        handledBy: "ai_native_flow",
        leadId,
        conversationId,
        status: "enqueued",
      },
    };
  } catch (err) {
    logError("native_agent_enqueue_failed", {
      ...logCtx,
      error: errorMessage(err),
    });
    // Fallback: retorna handled=false pra webhook tentar o pipeline legacy
    // como last resort. Cliente nunca fica sem resposta por falha de DB.
    return {
      handled: false,
      response: {
        ok: false,
        skipped: "enqueue_error",
      },
    };
  }
}

// ============================================================================
// executeDebouncedBatch — chamado pelo cron flush
// ============================================================================

export async function executeDebouncedBatch(input: {
  db: AgentDb;
  orgId: string;
  batch: DebounceFlushBatch;
  requestId?: string;
}): Promise<{ runId: string | null; status: "skipped" | "succeeded" | "failed" }> {
  const { db, orgId, batch, requestId } = input;
  const logCtx = {
    organization_id: orgId,
    request_id: requestId ?? null,
    agent_conversation_id: batch.agent_conversation_id,
  };

  try {
    // 1. Load agent_conversation pra resolver config_id, lead_id, current_node_id.
    const { data: agentConvRow, error: agentConvErr } = await db
      .from("agent_conversations")
      .select(
        "id, config_id, lead_id, crm_conversation_id, current_node_id, variables, ai_control_epoch",
      )
      .eq("organization_id", orgId)
      .eq("id", batch.agent_conversation_id)
      .maybeSingle();
    if (agentConvErr || !agentConvRow) {
      logError("flow_executor_load_conv_failed", {
        ...logCtx,
        error: agentConvErr?.message ?? "not_found",
      });
      return { runId: null, status: "failed" };
    }
    const agentConv = agentConvRow as {
      id: string;
      config_id: string;
      lead_id: string | null;
      crm_conversation_id: string | null;
      current_node_id: string | null;
      ai_control_epoch?: number | null;
    };
    const expectedControlEpoch = agentConv.ai_control_epoch ?? 0;

    if (!agentConv.lead_id || !agentConv.crm_conversation_id) {
      return { runId: null, status: "skipped" };
    }

    // 2. Load agent_config + flow + lead phone + whatsapp_connection em
    // paralelo.
    const [configRes, flowRes, leadRes, connRes] = await Promise.all([
      db
        .from("agent_configs")
        .select("id, model, system_prompt, humanization_config")
        .eq("organization_id", orgId)
        .eq("id", agentConv.config_id)
        .maybeSingle(),
      loadFlowByConfigId(db, orgId, agentConv.config_id),
      db
        .from("leads")
        .select("phone")
        .eq("organization_id", orgId)
        .eq("id", agentConv.lead_id)
        .maybeSingle(),
      db
        .from("whatsapp_connections")
        // Cleanup (mai/2026): explicit field list em vez de `*`. Garante
        // que createProvider() recebe os 7 campos esperados mesmo se
        // schema diverge em org legacy (memory regra "selects devem
        // listar campos explicitos").
        .select(
          "provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token",
        )
        .eq("organization_id", orgId)
        .eq("status", "connected")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (configRes.error || !configRes.data) {
      logError("flow_executor_no_config", logCtx);
      return { runId: null, status: "failed" };
    }
    if (!flowRes) {
      logError("flow_executor_no_flow", logCtx);
      return { runId: null, status: "skipped" };
    }
    if (leadRes.error || !leadRes.data) {
      logError("flow_executor_no_lead", logCtx);
      return { runId: null, status: "failed" };
    }
    if (connRes.error || !connRes.data) {
      logError("flow_executor_no_connection", logCtx);
      return { runId: null, status: "failed" };
    }

    const agentConfig = configRes.data as {
      id: string;
      model: string;
      system_prompt: string;
      humanization_config?: unknown;
    };
    const humanization = normalizeHumanizationConfig(agentConfig.humanization_config);
    const leadPhone = (leadRes.data as { phone: string }).phone;
    // createProvider espera a row inteira de whatsapp_connections — defensive cast.
    const provider = createProvider(connRes.data as Parameters<typeof createProvider>[0]);

    // 3. Insere agent_runs row (status='running'). Audit minimal — PR 6
    // adiciona tokens/cost.
    const { data: runRow, error: runErr } = await db
      .from("agent_runs")
      .insert({
        organization_id: orgId,
        agent_conversation_id: agentConv.id,
        inbound_message_id: batch.latest_inbound_message_id,
        status: "running",
        model: agentConfig.model,
        tokens_input: 0,
        tokens_output: 0,
        cost_usd_cents: 0,
        duration_ms: 0,
      })
      .select("id")
      .single();
    const runId = (runRow as { id?: string } | null)?.id ?? null;
    if (runErr) {
      // Não-fatal — segue sem audit row.
      logError("flow_executor_run_insert_failed", {
        ...logCtx,
        error: runErr.message,
      });
    }

    // 4. Provider realtime que envia via WhatsApp + persiste outbound em
    // messages. Passa humanization pra ele aplicar split + delay entre
    // chunks.
    const realtimeProvider = createRealtimeProvider({
      db,
      provider,
      leadPhone,
      leadId: agentConv.lead_id,
      conversationId: agentConv.crm_conversation_id,
      organizationId: orgId,
      humanization,
      sendGuard: {
        db,
        organizationId: orgId,
        conversationId: agentConv.crm_conversation_id,
        agentConversationId: agentConv.id,
        expectedControlEpoch,
      },
    });

    // 5. Build FlowRunContext + roda o flow.
    const startedAt = Date.now();
    const ctx: FlowRunContext = {
      flow: flowRes,
      agentConfigId: agentConfig.id,
      organizationId: orgId,
      crmConversationId: agentConv.crm_conversation_id,
      agentConversationId: agentConv.id,
      leadId: agentConv.lead_id,
      inboundMessage: {
        text: batch.concatenated_text,
        received_at: batch.latest_received_at,
      },
      provider: realtimeProvider,
      dryRun: false,
      flowConfig: flowRes.config,
    };

    const result = await runFlow(db, ctx, agentConv.current_node_id);
    const duration = Date.now() - startedAt;

    // 6. Persiste current_node_id, last_interaction_at e acumula tokens.
    // tokens_used_total é incremento — V1 faz SELECT + UPDATE (V2 pode
    // virar RPC atômico se houver concorrência alta).
    const totalTokensTurn = result.tokens_input + result.tokens_output;
    const { data: convRow } = await db
      .from("agent_conversations")
      .select("tokens_used_total")
      .eq("organization_id", orgId)
      .eq("id", agentConv.id)
      .maybeSingle();
    const prevTotal =
      (convRow as { tokens_used_total?: number } | null)?.tokens_used_total ?? 0;
    await db
      .from("agent_conversations")
      .update({
        current_node_id: result.ending_node_id,
        last_interaction_at: new Date().toISOString(),
        tokens_used_total: prevTotal + totalTokensTurn,
      })
      .eq("organization_id", orgId)
      .eq("id", agentConv.id);

    if (runId) {
      const finalStatus = result.fatal_error ? "failed" : "succeeded";
      // PR 6 (mai/2026): audit completo de tokens + cost. tokens vêm
      // acumulados do runner.tokens_input/output (soma de cada
      // iteração LLM ping-pong). cost calculado a partir do model.
      const costCents = calculateCostUsdCents(
        agentConfig.model,
        result.tokens_input,
        result.tokens_output,
      );
      await db
        .from("agent_runs")
        .update({
          status: finalStatus,
          duration_ms: duration,
          tokens_input: result.tokens_input,
          tokens_output: result.tokens_output,
          cost_usd_cents: costCents,
          error_msg: result.fatal_error ?? null,
        })
        .eq("id", runId);
    }

    return {
      runId,
      status: result.fatal_error ? "failed" : "succeeded",
    };
  } catch (err) {
    logError("flow_executor_unhandled", {
      ...logCtx,
      error: errorMessage(err),
    });
    return { runId: null, status: "failed" };
  }
}

// ============================================================================
// flushReadyConversations — invocado pelo cron /api/ai-agent/debounce-flush
// ============================================================================
//
// V1 delega 100% pro debounce.ts (que já tem claim/load/complete lock).
// Esse export existe pra mantener a rota cron compilando — chama
// `flushReadyConversationsImpl` direto.

export async function flushReadyConversations(): Promise<{
  processed: number;
  errors: string[];
}> {
  // Não implementado aqui — a rota /api/ai-agent/debounce-flush usa
  // diretamente o helper `flushReadyConversations` de debounce.ts.
  // Mantenho assinatura pra retrocompat de import (caller exotérico).
  return { processed: 0, errors: [] };
}
