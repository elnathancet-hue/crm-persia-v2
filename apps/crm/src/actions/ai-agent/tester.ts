"use server";

import type {
  AgentConfig,
  AgentStepType,
  NativeHandlerName,
  TesterEvent,
  TesterLiveRequest,
  TesterLiveResponse,
  TesterRequest,
  TesterResponse,
  TesterSkipReason,
  TesterStepSummary,
} from "@persia/shared/ai-agent";
import { normalizeHumanizationConfig } from "@persia/shared/ai-agent";
import type { AgentDb } from "@/lib/ai-agent/db";
import {
  executeDebouncedBatch,
  executeTesterAgent,
  tryEnqueueForNativeAgent,
} from "@/lib/ai-agent/executor";
import {
  buildTesterIncomingMessage,
  ensureTesterContext,
  resetTesterConversation as resetTesterConvImpl,
} from "@/lib/ai-agent/tester-context";
import {
  makeTesterProvider,
  pushSkippedEvent,
} from "@/lib/ai-agent/tester-provider";
import { requireAgentRole } from "./utils";

interface StepRow {
  step_type: AgentStepType;
  tool_id: string | null;
  native_handler: NativeHandlerName | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  duration_ms: number;
}

// ============================================================================
// Tester ANTIGO (single-shot, sem split/debounce) — mantido pra compatibilidade
// com testes existentes e usos diretos via API. UI Tester migra pra testAgentLive.
// ============================================================================

export async function testAgent(req: TesterRequest): Promise<TesterResponse> {
  const { db, orgId } = await requireAgentRole("admin");
  return testAgentForOrg(orgId, req, db);
}

export async function testAgentForOrg(
  orgId: string,
  req: TesterRequest,
  dbOverride?: AgentDb,
): Promise<TesterResponse> {
  const db = dbOverride ?? (await requireAgentRole("admin")).db;
  if (!req.config_id) throw new Error("config_id e obrigatorio");
  if (!req.message?.trim()) throw new Error("Mensagem de teste e obrigatoria");

  const result = await executeTesterAgent({
    db,
    orgId,
    configId: req.config_id,
    stageId: req.stage_id,
    message: req.message.trim(),
    state: req.conversation_state,
  });

  const steps = await loadStepsForRun(db, orgId, result.runId);

  return {
    run_id: result.runId,
    status: result.status,
    assistant_reply: result.assistantReply,
    steps,
    tokens_used: result.tokensInput + result.tokensOutput,
    cost_usd_cents: result.costUsdCents,
    next_stage_id: result.nextStageId,
    error: result.error,
  };
}

// ============================================================================
// Tester FIEL (PR-AI-AGENT-TESTER-FAITHFUL, mai/2026)
// ----------------------------------------------------------------------------
// Reproduz EXATAMENTE o pipeline de producao:
//   1. ensureTesterContext: lead + crm_conversation persistentes
//   2. tryEnqueueForNativeAgent: feature flag → routing → pause/resume →
//      business hours → enqueue em pending_messages (real)
//   3. Se enqueued, executeDebouncedBatch (real, dryRun=true) → executor
//      roda LLM, tools simuladas, sendAssistantReply → split + delay + typing
//      capturados em provider stub
//   4. Eventos retornados em ordem cronologica pra UI reconstruir conversa
// ============================================================================

export async function testAgentLive(
  req: TesterLiveRequest,
): Promise<TesterLiveResponse> {
  const { db, orgId, supabase } = await requireAgentRole("admin");
  if (!req.config_id) throw new Error("config_id e obrigatorio");
  if (!req.message?.trim()) throw new Error("Mensagem e obrigatoria");

  // 1. Carrega config do agente alvo pra:
  //    a) snapshot do humanization_config (UI mostra "split=on, etc")
  //    b) validar que existe + esta active (mensagem amigavel pre-pipeline)
  //
  // O agente que ATENDE pode ser outro (routing por entry_conditions
  // pode pegar um secundario). Aqui carregamos o config_id requisitado
  // apenas pra snapshot. O pipeline real escolhe via pickAgentForConversation.
  const { data: configRow, error: configErr } = await db
    .from("agent_configs")
    .select("*")
    .eq("id", req.config_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (configErr || !configRow) {
    throw new Error("Agente nao encontrado nesta organizacao");
  }
  const config = configRow as AgentConfig & { humanization_config?: unknown };
  const humanization = normalizeHumanizationConfig(config.humanization_config);

  // 2. Garante lead/conv Tester
  await ensureTesterContext(db, orgId);

  // 3. Monta provider stub + msg sintetica
  const { provider, events } = makeTesterProvider();
  const msg = buildTesterIncomingMessage(orgId, req.message.trim());

  // 4. Pipeline real ate enqueue
  const outcome = await tryEnqueueForNativeAgent({
    supabase,
    orgId,
    provider,
    msg,
    requestId: `tester-live-${crypto.randomUUID()}`,
  });

  // Tradus "outcome" em algo util pra UI
  const baseResponse: TesterLiveResponse = {
    run_id: null,
    events,
    steps: [],
    next_stage_id: null,
    tokens_used: 0,
    cost_usd_cents: 0,
    applied_config: {
      split_enabled: humanization.split_enabled,
      split_threshold_chars: humanization.split_threshold_chars,
      split_delay_seconds: humanization.split_delay_seconds,
      business_hours_enabled: humanization.business_hours_enabled,
      pause_keywords: humanization.pause_keywords,
      resume_keywords: humanization.resume_keywords,
    },
  };

  if (!outcome.handled) {
    pushSkippedEvent(events, outcome.reason ?? "other");
    return {
      ...baseResponse,
      skipped: mapSkipReason(outcome.reason),
      human_message: humanReasonMessage(outcome.reason),
    };
  }

  // Outcome handled — varias possibilidades:
  // - response.skipped === 'paused_by_keyword' → pausa acabou de ser ativada
  // - response.skipped === 'paused_active'     → ja estava pausada
  // - response.skipped === 'after_hours'       → fora do horario (msg enviada)
  // - response.skipped === 'native_agent_handoff' → resume word reativou
  // - enqueued: true → mensagem foi pra fila de debounce
  const response = (outcome as { response: Record<string, unknown> }).response;
  const enqueued = response?.enqueued === true;
  const skippedReason = response?.skipped as string | undefined;

  if (!enqueued) {
    pushSkippedEvent(events, skippedReason ?? "other");
    return {
      ...baseResponse,
      skipped: mapSkipReason(skippedReason),
      human_message: humanSkippedMessage(skippedReason, humanization),
    };
  }

  // 5. Enqueued — agora flushear. expedite=true (default) chama
  // executeDebouncedBatch diretamente; expedite=false espera o
  // debounce_window real (pra reproduzir bug de timing).
  if (!req.expedite_debounce) {
    const waitMs = config.debounce_window_ms ?? 10_000;
    await sleep(waitMs);
  }

  // Acha o batch que acabou de enfileirar.
  // Conv id veio dentro do outcome.response.conversationId... espera, nao —
  // response.conversationId e o CRM conversation_id, nao o agent_conversation_id.
  // Precisamos achar o agent_conversation_id da conv tester.
  const agentConvId = await loadTesterAgentConversationId(db, orgId);
  if (!agentConvId) {
    return {
      ...baseResponse,
      skipped: "other",
      human_message:
        "Agente foi enfileirado mas a agent_conversation nao foi encontrada — debug",
    };
  }

  // Pega o batch pendente desta conv (queue tem 1 batch ativo por conv)
  const batch = await loadPendingBatchForConv(db, orgId, agentConvId);
  if (!batch) {
    return {
      ...baseResponse,
      skipped: "other",
      human_message:
        "Mensagem enfileirada mas batch nao foi encontrado — possivelmente ja flushado",
    };
  }

  const flushResult = await executeDebouncedBatch({
    db,
    orgId,
    batch,
    requestId: `tester-flush-${crypto.randomUUID()}`,
    dryRun: true,
    isTest: true,
    providerOverride: provider,
  });

  // 6. Apos flush, marca pending_messages como flushadas pra nao
  // re-disparar em runs futuros. Em prod isso e feito pelo
  // complete_agent_conversation_flush RPC (via flushReadyConversations);
  // aqui chamamos manualmente porque pulamos o flushReady wrapper.
  await markPendingFlushed(db, orgId, agentConvId, batch.pending_message_ids);

  if (!flushResult.runId) {
    return {
      ...baseResponse,
      skipped: "other",
      human_message: `Flush retornou status=${flushResult.status} sem run_id`,
    };
  }

  // 7. Hidrata steps + run details
  const steps = await loadStepsForRun(db, orgId, flushResult.runId);
  const { data: runRow } = await db
    .from("agent_runs")
    .select("tokens_input, tokens_output, cost_usd_cents")
    .eq("id", flushResult.runId)
    .eq("organization_id", orgId)
    .maybeSingle();

  const { data: convRow } = await db
    .from("agent_conversations")
    .select("current_stage_id")
    .eq("id", agentConvId)
    .maybeSingle();

  return {
    ...baseResponse,
    run_id: flushResult.runId,
    events,
    steps,
    next_stage_id: (convRow?.current_stage_id as string | null) ?? null,
    tokens_used:
      (runRow?.tokens_input as number | undefined ?? 0) +
      (runRow?.tokens_output as number | undefined ?? 0),
    cost_usd_cents: (runRow?.cost_usd_cents as number | undefined) ?? 0,
  };
}

export async function resetTesterConversation(): Promise<{ ok: true }> {
  const { db, orgId } = await requireAgentRole("admin");
  await resetTesterConvImpl(db, orgId);
  return { ok: true };
}

// ============================================================================
// Helpers
// ============================================================================

async function loadStepsForRun(
  db: AgentDb,
  orgId: string,
  runId: string,
): Promise<TesterStepSummary[]> {
  const { data: stepsData, error: stepsError } = await db
    .from("agent_steps")
    .select("step_type, tool_id, native_handler, input, output, duration_ms")
    .eq("organization_id", orgId)
    .eq("run_id", runId)
    .order("order_index", { ascending: true });

  if (stepsError) throw new Error(stepsError.message);

  const toolIds = Array.from(
    new Set((stepsData ?? []).map((step: StepRow) => step.tool_id).filter(Boolean)),
  ) as string[];
  const toolNames = await loadToolNames(db, orgId, toolIds);

  return ((stepsData ?? []) as StepRow[]).map((step) => ({
    step_type: step.step_type,
    tool_name: step.tool_id ? toolNames.get(step.tool_id) : undefined,
    native_handler: step.native_handler ?? undefined,
    input: step.input ?? undefined,
    output: step.output ?? undefined,
    duration_ms: step.duration_ms,
  }));
}

async function loadToolNames(
  db: AgentDb,
  orgId: string,
  toolIds: string[],
): Promise<Map<string, string>> {
  if (toolIds.length === 0) return new Map();
  const { data } = await db
    .from("agent_tools")
    .select("id, name")
    .eq("organization_id", orgId)
    .in("id", toolIds);
  return new Map((data ?? []).map((tool: { id: string; name: string }) => [tool.id, tool.name]));
}

async function loadTesterAgentConversationId(
  db: AgentDb,
  orgId: string,
): Promise<string | null> {
  // Acha a agent_conversation criada pelo pipeline para o lead Tester.
  // Como ensureTesterContext garante 1 lead unico por org com
  // metadata.is_test=true, joinamos.
  const { data: leads } = await db
    .from("leads")
    .select("id")
    .eq("organization_id", orgId)
    .contains("metadata", { is_test: true })
    .limit(1);
  const leadId = leads?.[0]?.id;
  if (!leadId) return null;

  const { data: conv } = await db
    .from("agent_conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return conv?.id ?? null;
}

interface PendingBatchRow {
  id: string;
  text: string | null;
  message_type: string;
  media_ref: string | null;
  inbound_message_id: string | null;
  received_at: string;
}

async function loadPendingBatchForConv(
  db: AgentDb,
  orgId: string,
  agentConvId: string,
): Promise<import("@persia/shared/ai-agent").DebounceFlushBatch | null> {
  const { data: rows } = await db
    .from("pending_messages")
    .select("id, text, message_type, media_ref, inbound_message_id, received_at")
    .eq("organization_id", orgId)
    .eq("agent_conversation_id", agentConvId)
    .is("flushed_at", null)
    .order("received_at", { ascending: true });

  const pending = (rows ?? []) as PendingBatchRow[];
  if (pending.length === 0) return null;

  const concatenated = pending
    .map((m) => m.text ?? "")
    .filter((t) => t.length > 0)
    .join("\n");
  const latestInboundId =
    [...pending].reverse().find((m) => m.inbound_message_id !== null)
      ?.inbound_message_id ?? null;

  return {
    agent_conversation_id: agentConvId,
    organization_id: orgId,
    pending_message_ids: pending.map((m) => m.id),
    concatenated_text: concatenated,
    latest_inbound_message_id: latestInboundId,
    earliest_received_at: pending[0]!.received_at,
    latest_received_at: pending[pending.length - 1]!.received_at,
  };
}

async function markPendingFlushed(
  db: AgentDb,
  orgId: string,
  agentConvId: string,
  pendingMessageIds: string[],
): Promise<void> {
  // Usa o mesmo RPC que prod (flushReadyConversations chama):
  // - marca pending_messages.flushed_at = now()
  // - zera next_flush_at + flush_claimed_at na agent_conversation
  // Garante paridade com prod e fica imune a refactors do schema.
  await (db as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
  }).rpc("complete_agent_conversation_flush", {
    p_organization_id: orgId,
    p_agent_conversation_id: agentConvId,
    p_pending_message_ids: pendingMessageIds,
  });
}

function mapSkipReason(raw: string | undefined): TesterSkipReason | undefined {
  if (!raw) return undefined;
  switch (raw) {
    case "feature_flag_off":
    case "no_active_config":
    case "paused_by_keyword":
    case "paused_active":
    case "after_hours":
    case "native_agent_handoff":
      return raw;
    default:
      return "other";
  }
}

function humanReasonMessage(reason: string | undefined): string {
  switch (reason) {
    case "feature_flag_off":
      return "Agente nativo desligado nesta organizacao (settings.features.native_agent_enabled=false)";
    case "no_active_config":
      return "Nenhum agente ativo nesta organizacao";
    case "exception":
      return "Erro inesperado no pipeline — verifique logs";
    default:
      return reason
        ? `Pipeline retornou handled=false (reason=${reason})`
        : "Pipeline retornou handled=false sem motivo";
  }
}

function humanSkippedMessage(
  reason: string | undefined,
  humanization: ReturnType<typeof normalizeHumanizationConfig>,
): string {
  switch (reason) {
    case "paused_by_keyword":
      return `IA pausada pela palavra-chave (${humanization.pause_keywords.join(", ")}). Mande uma palavra de reativacao (${humanization.resume_keywords.join(", ")}) ou clique em Resetar.`;
    case "paused_active":
      return "Conversa esta pausada. Mande uma palavra de reativacao ou Resetar.";
    case "after_hours":
      return `Fora do horario comercial — agente enviou a after_hours_message e ficou em silencio. Cooldown de 6h ativo.`;
    case "native_agent_handoff":
      return "Palavra de reativacao detectada — IA retomou. Mande a proxima mensagem.";
    default:
      return reason ? `Pipeline pulou (motivo: ${reason})` : "Pipeline nao processou a mensagem";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
