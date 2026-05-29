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
import { cacheLeadAvatarFromUrl } from "@/lib/lead-avatar-cache";
import OpenAI from "openai";
import {
  NATIVE_AGENT_FEATURE_FLAG,
  calculateCostUsdCents,
  findEntryNode,
  isAutoPauseExpired,
  isWithinBusinessHours,
  matchesPauseKeyword,
  matchesResumeKeyword,
  normalizeHumanizationConfig,
  pickSecondaryAgent,
  shouldResetCurrentNodeId,
  shouldSendAfterHoursMessage,
  shouldTriggerFlowFromInbound,
  type AgentConfig,
  type AgentConversation,
  type AgentEntryCondition,
  type DebounceFlushBatch,
  type LeadStateForRouting,
  type OrganizationSettings,
} from "@persia/shared/ai-agent";
import { errorMessage, logError } from "@/lib/observability";
import { assertWithinCostLimits } from "./cost-limits";
import { asAgentDb, type AgentDb } from "./db";
import { loadFlowByConfigId } from "./flow/loader";
import { getOpenAiApiMode } from "./flow/openai-api-mode";
import { createRealtimeProvider } from "./flow/realtime-provider";
import { runFlow } from "./flow/runner";
import type { FlowRunContext } from "./flow/types";
import { GuardrailError } from "./guardrails";
import { sendAssistantReply } from "./send-reply";
import {
  runConversationSummarization,
  shouldTriggerConversationSummarization,
} from "./summarization";

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

interface RoutingAgentRow {
  id: string;
  debounce_window_ms?: number | null;
  humanization_config?: unknown;
  new_lead_stage_id?: string | null;
}

async function loadLeadStateForRouting(
  db: AgentDb,
  orgId: string,
  leadId: string,
): Promise<LeadStateForRouting> {
  const { data: leadRow } = await db
    .from("leads")
    .select("status, stage_id")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();

  const { data: tagRows } = await db
    .from("lead_tags")
    .select("tags(name)")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId);

  const { data: segmentRows } = await (db as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => Promise<{
            data: Array<{ segment_id: string }> | null;
          }>;
        };
      };
    };
  })
    .from("segment_memberships")
    .select("segment_id")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId);

  return {
    tags: ((tagRows ?? []) as Array<{ tags?: { name?: string | null } | null }>)
      .map((row) => row.tags?.name?.trim().toLowerCase())
      .filter((tag): tag is string => Boolean(tag)),
    segment_ids: (segmentRows ?? []).map((row) => row.segment_id),
    pipeline_stage_id:
      (leadRow as { stage_id?: string | null } | null)?.stage_id ?? null,
    status: (leadRow as { status?: string | null } | null)?.status ?? null,
  };
}

async function pickAgentForLead(
  db: AgentDb,
  orgId: string,
  primary: RoutingAgentRow,
  leadId: string,
  messageText: string,
): Promise<RoutingAgentRow> {
  const { data: secondaryRows } = await db
    .from("agent_configs")
    .select("id, debounce_window_ms, humanization_config, new_lead_stage_id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .eq("is_primary", false);

  const secondaryAgents = (secondaryRows ?? []) as RoutingAgentRow[];
  if (secondaryAgents.length === 0) return primary;

  const { data: conditionRows } = await db
    .from("agent_entry_conditions")
    .select("agent_config_id, condition_type, condition_value, priority, created_at")
    .eq("organization_id", orgId)
    .in("agent_config_id", secondaryAgents.map((agent) => agent.id));

  const conditionsByAgent = new Map<string, AgentEntryCondition[]>();
  for (const row of (conditionRows ?? []) as AgentEntryCondition[]) {
    const list = conditionsByAgent.get(row.agent_config_id) ?? [];
    list.push(row);
    conditionsByAgent.set(row.agent_config_id, list);
  }

  const leadState = await loadLeadStateForRouting(db, orgId, leadId);
  const selected = pickSecondaryAgent(
    secondaryAgents.map((agent) => ({
      agent,
      conditions: conditionsByAgent.get(agent.id) ?? [],
    })),
    leadState,
    messageText,
  );

  return selected ?? primary;
}

async function loadRoutingAgentById(
  db: AgentDb,
  orgId: string,
  agentId: string,
): Promise<RoutingAgentRow | null> {
  const { data } = await db
    .from("agent_configs")
    .select("id, debounce_window_ms, humanization_config, new_lead_stage_id")
    .eq("organization_id", orgId)
    .eq("id", agentId)
    .maybeSingle();

  return (data as RoutingAgentRow | null) ?? null;
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
  const primaryAgent = primaryRow as RoutingAgentRow;
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

  // PR-1 (mai/2026): rastreia se ja temos agent_conversations conhecido
  // (SELECT achou OU INSERT bem-sucedido OU re-SELECT pos-23505). Se sim,
  // falha pos-criacao NAO cai no fallback legacy — legacy criaria
  // conversation/messages duplicados em paralelo com o estado nativo.
  // Em vez disso, retornamos handled=true status="native_error" e o cron
  // flush retenta na proxima janela (lease-based claim em debounce.ts).
  let agentConvKnown = false;

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
    let createdLead = false;
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
        })
        .select("id")
        .single();
      if (leadErr?.code === "23505") {
        // PR-1 (mai/2026): paridade com incoming-pipeline.ts:118-126.
        // Race entre 2 webhooks do mesmo phone novo chegando em <100ms.
        // UNIQUE partial (migration 010, org+phone WHERE phone NOT NULL)
        // dispara 23505 no perdedor. Re-SELECT pra pegar o lead vencedor
        // sem isNewLead (evita disparar onNewLead/auto-deal duplicado —
        // o vencedor ja fez isso pela trigger lead_auto_deal).
        const { data: existingLead } = await db
          .from("leads")
          .select("id")
          .eq("organization_id", orgId)
          .eq("phone", phone)
          .maybeSingle();
        if (!existingLead) {
          throw new Error(`lead_race_refetch_failed: phone=${phone}`);
        }
        lead = existingLead;
        // createdLead fica false — evita avatar fetch + onNewLead duplicados.
      } else if (leadErr || !newLead) {
        throw new Error(`lead_create_failed: ${leadErr?.message ?? "unknown"}`);
      } else {
        lead = newLead;
        createdLead = true;
        // Bug A fix (mai/2026): busca foto WhatsApp em background.
        // Não bloqueia o pipeline — se UAZAPI falhar, lead fica sem
        // avatar e UI cai no fallback de iniciais. Rodamos só uma vez
        // (na criação do lead) pra evitar rate limit em /chat/details.
        const newLeadId = newLead.id;
        void (async () => {
          try {
            const remoteAvatarUrl = await input.provider.getContactProfilePic(phone);
            const avatarUrl = await cacheLeadAvatarFromUrl({
              organizationId: input.orgId,
              leadId: newLeadId,
              remoteUrl: remoteAvatarUrl,
            });
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
    }
    const leadId = (lead as { id: string }).id;
    const selectedAgent = await pickAgentForLead(
      db,
      orgId,
      primaryAgent,
      leadId,
      messageContent ?? inboundText,
    );
    let agentConfigId = selectedAgent.id;
    let finalAgent = selectedAgent;

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

    // 9. Resolve agent_conversation. Idempotente por (lead_id,
    // crm_conversation_id) — não temos UNIQUE constraint mas usamos
    // find-or-create, mas só depois do guard de human-owned abaixo.
    //
    // Bug J fix (mai/2026): routing stickiness. O find NÃO filtra por
    // config_id — busca QUALQUER agent_conversations pra (lead, conv).
    // Se existe row (lead já está conversando com algum agente nessa
    // conversation), força stickiness: usa o config_id daquele row em
    // vez do que pickAgentForLead retornou. Evita o bug do PR #339 onde
    // msg #1 ia pro agente A e msg #2 (que casa regra do B) criava 2ª
    // row em agent_conversations -> lead falando com 2 agentes em
    // paralelo. Mudança de agente só acontece em conversation NOVA.
    let { data: agentConv } = await db
      .from("agent_conversations")
      .select("id, config_id, current_node_id, human_handoff_at, after_hours_notified_at, ai_control_epoch")
      .eq("organization_id", orgId)
      .eq("lead_id", leadId)
      .eq("crm_conversation_id", conversationId)
      .maybeSingle();
    if (agentConv) {
      agentConvKnown = true;
      const existingConfigId = (agentConv as { config_id?: string | null }).config_id;
      if (existingConfigId && existingConfigId !== agentConfigId) {
        // Override pra manter stickiness com o agente que iniciou a conv
        agentConfigId = existingConfigId;
      }
    }
    const existingAgentConversation = Boolean(agentConv);

    if (existingAgentConversation) {
      const stickyAgent = await loadRoutingAgentById(db, orgId, agentConfigId);
      if (stickyAgent) {
        finalAgent = stickyAgent;
      }
    }

    // PR-1 (mai/2026): `let` em vez de `const` pra debounceWindowMs e
    // humanization — 23505 catch no INSERT do agent_conversations pode
    // trocar finalAgent pelo config do vencedor (multi-agent edge), e
    // precisamos atualizar esses valores derivados antes do enqueue.
    let debounceWindowMs =
      finalAgent.debounce_window_ms ?? DEBOUNCE_WINDOW_MS_DEFAULT;
    let humanization = normalizeHumanizationConfig(
      finalAgent.humanization_config,
    );
    const matchResume = matchesResumeKeyword(messageContent ?? "", humanization);

    // Human takeover guard: keep the new lead message in the CRM history.
    // A resume keyword is the one allowed exception: it must pass through so
    // the block below can restore `assigned_to=ai` and enqueue the AI turn.
    if (
      (conversation.assigned_to !== "ai" || conversation.status !== "active") &&
      !(existingAgentConversation && matchResume)
    ) {
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
        .select("id, config_id, current_node_id, human_handoff_at, after_hours_notified_at, ai_control_epoch")
        .single();
      if (agentConvErr?.code === "23505") {
        // PR-1 (mai/2026): race entre 2 webhooks paralelos do mesmo lead
        // chegando antes da UNIQUE conhecer o vencedor. UNIQUE partial
        // (migration 071) dispara 23505 no perdedor. Re-SELECT pra pegar
        // a linha do vencedor + aplicar stickiness pelo config_id dele
        // (paridade com o branch SELECT acima, linhas 560-574).
        const { data: existing, error: refetchErr } = await db
          .from("agent_conversations")
          .select("id, config_id, current_node_id, human_handoff_at, after_hours_notified_at, ai_control_epoch")
          .eq("organization_id", orgId)
          .eq("lead_id", leadId)
          .eq("crm_conversation_id", conversationId)
          .maybeSingle();
        if (refetchErr || !existing) {
          throw new Error(
            `agent_conv_race_refetch_failed: ${refetchErr?.message ?? "no_row_after_23505"}`,
          );
        }
        agentConv = existing;
        agentConvKnown = true;
        const winnerConfigId = (existing as { config_id?: string | null }).config_id;
        if (winnerConfigId && winnerConfigId !== agentConfigId) {
          // Vencedor escolheu config diferente (edge multi-agent). Mantem
          // stickiness com ele em vez de duplicar inserts. humanization
          // ja foi computada com o config "perdedor" — pra correcao 100%
          // teria que recomputar humanization aqui tambem, mas como
          // ja passamos do bloco de business_hours/pause keyword,
          // recarregar agora nao tem efeito util. Logamos pra rastrear
          // frequencia em prod.
          const attemptedConfigId = agentConfigId;
          agentConfigId = winnerConfigId;
          const stickyAgent = await loadRoutingAgentById(db, orgId, agentConfigId);
          if (stickyAgent) {
            finalAgent = stickyAgent;
            // Re-derivar valores que dependem do finalAgent. matchResume
            // ja foi avaliado com humanization do perdedor, mas o flow
            // de pause/resume abaixo (linha 686+) recompoe baseado em
            // humanization corrente — entao a atualizacao aqui se
            // propaga corretamente.
            debounceWindowMs = finalAgent.debounce_window_ms ?? DEBOUNCE_WINDOW_MS_DEFAULT;
            humanization = normalizeHumanizationConfig(finalAgent.humanization_config);
          }
          logError("native_agent_race_config_mismatch", {
            ...logCtx,
            lead_id: leadId,
            crm_conversation_id: conversationId,
            attempted_config_id: attemptedConfigId,
            winner_config_id: winnerConfigId,
          });
        }
      } else if (agentConvErr || !newAgentConv) {
        throw new Error(
          `agent_conv_create_failed: ${agentConvErr?.message ?? "unknown"}`,
        );
      } else {
        agentConv = newAgentConv;
        agentConvKnown = true;
      }
    }
    const agentConversationId = (agentConv as { id: string }).id;
    const humanHandoffAt = (agentConv as { human_handoff_at?: string | null })
      .human_handoff_at ?? null;
    const afterHoursNotifiedAt = (agentConv as {
      after_hours_notified_at?: string | null;
    }).after_hours_notified_at ?? null;
    const aiControlEpoch =
      (agentConv as { ai_control_epoch?: number | null }).ai_control_epoch ?? 0;

    if (createdLead) {
      const finalNewLeadStage = await resolveAgentNewLeadStage(
        db,
        orgId,
        finalAgent.new_lead_stage_id,
      );
      if (finalNewLeadStage) {
        await db
          .from("leads")
          .update({
            pipeline_id: finalNewLeadStage.pipeline_id,
            stage_id: finalNewLeadStage.id,
          })
          .eq("organization_id", orgId)
          .eq("id", leadId);
      }
    }

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
    const matchPause = matchesPauseKeyword(messageContent ?? "", humanization);

    if (matchResume) {
      // Bug J fix (mai/2026): resume keyword agora devolve controle real
      // pra IA. Antes só limpava human_handoff_at, mas se operador tinha
      // assumido manualmente via chat (assigned_to=userId, status="waiting_human"
      // — setado por markConversationHumanOwnedAfterOperatorReply em
      // actions/messages.ts:104), o send-guard rejeitava com
      // "conversation_not_owned_by_ai" e IA ficava travada pra sempre.
      //
      // Fix: além de limpar handoff, também bumpa ai_control_epoch pra
      // invalidar runs stale do humano + restaura assigned_to=ai +
      // status=active no conversation. Isso casa com o que o botão manual
      // "Retomar IA" no chat-window faz, mantendo paridade.
      await db
        .from("agent_conversations")
        .update({
          human_handoff_at: null,
          human_handoff_reason: null,
          ai_control_epoch: aiControlEpoch + 1,
        })
        .eq("organization_id", orgId)
        .eq("id", agentConversationId);
      await db
        .from("conversations")
        .update({ assigned_to: "ai", status: "active" })
        .eq("organization_id", orgId)
        .eq("id", conversationId);
    } else if (matchPause) {
      // Bug K fix (mai/2026): bump ai_control_epoch igual ao Assumir manual.
      // Hoje o send-guard rejeita via `human_handoff_at IS NOT NULL` (linha
      // 73 do send-guard.ts), então funciona. Mas se um próximo PR mudar
      // ordem das checagens ou remover early-return, runs em flight ainda
      // conseguiriam enviar após pause. Inconsistente com:
      //  - actions/conversations.ts:54 (Assumir manual bumpa epoch)
      //  - actions/messages.ts:89 (operator reply bumpa epoch)
      //  - executor.ts:matchResume (resume keyword bumpa epoch — Bug J)
      // Esta mudança fecha o padrão: TODA transição de controle bump epoch.
      //
      // Backlog #8 Auditoria (mai/2026): endereca rodada 7 #4. Agora
      // atualiza tambem `conversations.assigned_to=null + status="waiting_human"`
      // — espelha matchResume (que vira AI/active) e os caminhos manuais
      // (Assumir IA / operator reply) que ja faziam isso. Antes, lead
      // mandava "PAUSAR" e chat-window continuava mostrando "AI assigned",
      // operador ficava sem visibilidade que a IA estava pausada.
      //
      // assigned_to=null (em vez de "queue" ou marker proprio) porque
      // ainda nao tem userId atribuido — espera operador clicar "Assumir"
      // no chat-window pra setar `assigned_to=userId`. Status
      // "waiting_human" e o canonical pra "esperando humano".
      await db
        .from("agent_conversations")
        .update({
          human_handoff_at: new Date().toISOString(),
          human_handoff_reason: "pause_keyword",
          ai_control_epoch: aiControlEpoch + 1,
        })
        .eq("organization_id", orgId)
        .eq("id", agentConversationId);
      await db
        .from("conversations")
        .update({ assigned_to: null, status: "waiting_human" })
        .eq("organization_id", orgId)
        .eq("id", conversationId);
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
      const shouldCheckEntryTrigger =
        !(agentConv as { current_node_id?: string | null }).current_node_id;
      const flow = shouldCheckEntryTrigger
        ? await loadFlowByConfigId(db, orgId, agentConfigId)
        : null;
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
      phase: agentConvKnown ? "post_agent_conv" : "pre_agent_conv",
    });
    // PR-1 (mai/2026): ramo pre/pos-criacao do agent_conversations.
    //
    // Pre-creation: nenhum estado nativo criado ainda. Webhook cai pro
    //   legacy pipeline (processIncomingMessage) — cliente recebe
    //   resposta via n8n/OpenAI como fallback. Inbound message ainda
    //   nao foi inserido OU foi inserido mas o legacy faz dedup pelo
    //   whatsapp_msg_id (incoming-pipeline.ts:58-66) e skipa.
    //
    // Post-creation: agent_conversations existe (criado por esta request
    //   OU encontrado via SELECT/23505 refetch). Cair pro legacy aqui
    //   geraria conflito: legacy chamaria n8n/OpenAI enquanto o cron
    //   flush eventualmente pega pending_messages dessa agent_conv. Lead
    //   recebe 2 respostas. Retornamos handled=true status=native_error
    //   pra webhook PARAR aqui — flush retenta na proxima janela quando
    //   pending_messages tiver entrada.
    if (agentConvKnown) {
      // Erro detalhado ja foi capturado em logError acima — nao expomos
      // o stack aqui pra nao vazar internals no response do webhook.
      return {
        handled: true,
        response: {
          ok: true,
          handledBy: "ai_native_flow",
          status: "native_error",
        },
      };
    }
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
    // PR-3 Auditoria (mai/2026): inclui human_handoff_at pra defense-in-depth
    // contra race entre claim e pause. flushReadyConversations ja filtra
    // por handoff IS NULL, mas operador pode pausar EXATAMENTE entre o
    // SELECT do candidate e o claim atomic. Re-load aqui pega a foto pos-claim.
    // PR-5 Auditoria (mai/2026): seleciona row inteira porque handlers
    // nativos (stop_agent, transfer_to_agent) precisam de history_summary,
    // variables, actions_executed_detail.
    const { data: agentConvRow, error: agentConvErr } = await db
      .from("agent_conversations")
      .select("*")
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
    const agentConv = agentConvRow as AgentConversation & {
      lead_id: string | null;
      crm_conversation_id: string | null;
      human_handoff_at?: string | null;
    };
    const expectedControlEpoch = agentConv.ai_control_epoch ?? 0;

    if (!agentConv.lead_id || !agentConv.crm_conversation_id) {
      return { runId: null, status: "skipped" };
    }

    // PR-3 Auditoria (mai/2026): defense-in-depth pos-claim. Race window
    // entre flushReadyConversations SELECT e claim_agent_conversation_flush
    // atomic permite operador pausar entre os dois. Skipa graciosamente
    // sem chamar OpenAI nem rodar tools — pending_messages fica enfileirado
    // ate o handoff ser limpo (proxima webhook do lead OU resume manual).
    if (agentConv.human_handoff_at) {
      logError("flow_executor_skipped_handoff", {
        ...logCtx,
        human_handoff_at: agentConv.human_handoff_at,
      });
      return { runId: null, status: "skipped" };
    }

    // 2. Load agent_config + flow + lead phone + whatsapp_connection em
    // paralelo.
    // PR-5 Auditoria (mai/2026): seleciona row inteira do agent_configs
    // (em vez de apenas model/system_prompt/humanization_config) porque
    // o FlowRunContext agora carrega o config pra handlers nativos
    // (stop_agent precisa do handoff_notification_template,
    // trigger_notification precisa do handoff_notification_target,
    // create_appointment respeita calendar_connection_id).
    const [configRes, flowRes, leadRes, connRes] = await Promise.all([
      db
        .from("agent_configs")
        .select("*")
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

    const agentConfig = configRes.data as AgentConfig;
    const humanization = normalizeHumanizationConfig(agentConfig.humanization_config);

    // PR-5 Auditoria (mai/2026): OpenAI client compartilhado pro flow
    // runner (assistant LLM) E handlers nativos (stop_agent gera handoff
    // brief, future handlers podem usar meta-IA). Best-effort: se
    // OPENAI_API_KEY nao estiver setada, openaiClient fica undefined e
    // handlers que precisam dele fazem fallback gracioso.
    const openaiClient = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : undefined;
    const leadPhone = (leadRes.data as { phone: string }).phone;
    // createProvider espera a row inteira de whatsapp_connections — defensive cast.
    const provider = createProvider(connRes.data as Parameters<typeof createProvider>[0]);

    // 3. Insere agent_runs row (status='running'). Audit minimal — PR 6
    // adiciona tokens/cost.
    //
    // PR 5 prep do plano docs/ai-agent/11-openai-responses-migration.md
    // (mai/2026): persiste o `provider_mode` snapshot via getOpenAiApiMode
    // pra permitir comparar runs chat vs responses no DB (migration 074).
    const apiMode = getOpenAiApiMode();
    const { data: runRow, error: runErr } = await db
      .from("agent_runs")
      .insert({
        organization_id: orgId,
        agent_conversation_id: agentConv.id,
        inbound_message_id: batch.latest_inbound_message_id,
        status: "running",
        model: agentConfig.model,
        provider_mode: apiMode,
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

    // 3b. PR-2 Auditoria (mai/2026): pre-run cost ceiling check.
    // Endereca rodada 6 #critica #1 — `assertWithinCostLimits` era dead
    // code, runtime nunca enforçava. Cliente cadastrava limite na UI
    // mas IA continuava respondendo indefinidamente.
    //
    // Pre-run usa tokensSoFarRun=0 — checa apenas os ceilings agregados
    // (agent_daily / org_daily / org_monthly) baseados em consumo
    // historico. Se ja estouraram, aborta o run sem chamar OpenAI.
    // Ceiling per-run e validado dentro do AI node (intra-loop).
    try {
      await assertWithinCostLimits({
        db,
        orgId,
        configId: agentConfig.id,
        agentConversationId: agentConv.id,
        tokensSoFarRun: 0,
        costSoFarRunUsdCents: 0,
      });
    } catch (err) {
      if (err instanceof GuardrailError) {
        logError("flow_executor_cost_ceiling_pre_run", {
          ...logCtx,
          config_id: agentConfig.id,
          reason: err.reason,
          message: err.message,
        });
        if (runId) {
          await db
            .from("agent_runs")
            .update({
              status: "failed",
              error_msg: `cost_ceiling:${err.reason}`,
              duration_ms: 0,
            })
            .eq("id", runId);
        }
        return { runId, status: "failed" };
      }
      throw err;
    }

    // 4. Provider realtime que envia via WhatsApp + persiste outbound em
    // messages. Passa humanization pra ele aplicar split + delay entre
    // chunks.
    // PR-3 Auditoria (mai/2026): sendGuard agora e compartilhado entre o
    // realtime-provider (last-mile no send_text) E o runner (checa antes
    // de cada AI/action node). Endereca rodada 7 #alta #3.
    const sendGuard = {
      db,
      organizationId: orgId,
      conversationId: agentConv.crm_conversation_id,
      agentConversationId: agentConv.id,
      expectedControlEpoch,
    };
    const realtimeProvider = createRealtimeProvider({
      db,
      provider,
      leadPhone,
      leadId: agentConv.lead_id,
      conversationId: agentConv.crm_conversation_id,
      organizationId: orgId,
      humanization,
      sendGuard,
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
      sendGuard,
      // PR-5 (mai/2026): contexto enriquecido pra handlers nativos.
      // buildNativeHandlerContext (runner.ts) injeta esses campos no
      // HandlerContextWithDb passado pra cada handler. Endereca rodada
      // 4 #critica — handlers que falhavam com "database context missing".
      agentConfig,
      agentConversation: agentConv,
      whatsappProvider: provider,
      openaiClient,
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

    // 6. Persiste current_node_id e last_interaction_at.
    //
    // PR-4 Auditoria (mai/2026): endereca rodada 1 #1 (Codex) + rodada 9 #4.
    // Helper shouldResetCurrentNodeId (em @persia/shared/ai-agent) decide
    // se o ending_node_id deve virar null antes de persistir — evita
    // reexecutar action/condition terminal na proxima mensagem do lead.
    //
    // Backlog #13 Auditoria (mai/2026): tokens_used_total removida via
    // migration 073 — era dado morto (nada consumia). agent_runs ja
    // guarda tokens_input/output + cost_usd_cents por run, agregado em
    // agent_usage_daily pra dashboards e cost-limits.
    const persistedNodeId = shouldResetCurrentNodeId(
      ctx.flowConfig,
      result.ending_node_id,
    )
      ? null
      : result.ending_node_id;

    await db
      .from("agent_conversations")
      .update({
        current_node_id: persistedNodeId,
        last_interaction_at: new Date().toISOString(),
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

    // Backlog #1 (mai/2026) — trigger summarization fire-and-forget.
    // Endereca rodada 6 #critica #3 do POST_CODEX_AUDIT_AGENT_FLOW_353.md.
    // Antes, summarization.ts era dead code. Agora, apos cada run
    // bem-sucedido, checa thresholds (turns desde ultimo summary OR
    // tokens acumulados) e dispara consolidacao via gpt-4o-mini.
    //
    // Fire-and-forget intencional: nao bloqueia retorno do flush. Lead
    // ja recebeu a resposta do turn atual; summary e pra prox turn.
    // Falha aqui = log + segue, proximo flush retenta (counters
    // acumulam).
    if (!result.fatal_error && openaiClient) {
      const shouldSummarize = shouldTriggerConversationSummarization(
        agentConv,
        agentConfig,
      );
      if (shouldSummarize) {
        void runConversationSummarization({
          db,
          openaiClient,
          orgId,
          agentConversation: agentConv,
        }).catch((err) => {
          // Best-effort: log mas nao propaga. runConversationSummarization
          // ja faz logError internamente — esse catch e safety net.
          logError("flow_executor_summarization_unhandled", {
            ...logCtx,
            error: errorMessage(err),
          });
        });
      }
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
