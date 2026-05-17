import type {
  AgentConfig,
  AgentConversation,
  AgentStage,
  AgentTool,
} from "@persia/shared/ai-agent";
import {
  clampDebounceWindowMs,
  clampRecentMessagesCount,
  clampTokenThreshold,
  clampTurnThreshold,
} from "@persia/shared/ai-agent";
import { phoneBR } from "@persia/shared/validation";
import type { IncomingMessage } from "@/lib/whatsapp/provider";
import { errorMessage, logError } from "@/lib/observability";
import { asRecord, mergeJsonObject, nowIso, type AgentDb } from "./db";
import { normalizeGuardrails } from "./guardrails";

export interface RuntimeCrmContext {
  leadId: string;
  crmConversationId: string;
  inboundMessageId: string | null;
}

export interface ResolvedAgentContext {
  config: AgentConfig;
  stage: AgentStage | null;
  agentConversation: AgentConversation;
  tools: AgentTool[];
  crm: RuntimeCrmContext;
}

export async function loadActiveAgentConfig(
  db: AgentDb,
  orgId: string,
): Promise<AgentConfig | null> {
  // PR-AGENT-INTEGRATION-3 (mai/2026): preferencia agente principal
  // (is_primary=true). Se nao existir, fallback pro mais antigo ativo
  // (retrocompat com agents sem is_primary setado).
  const { data: primary } = await db
    .from("agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();
  if (primary) return normalizeConfig(primary);

  const { data, error } = await db
    .from("agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeConfig(data);
}

export async function loadAgentConfigById(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<AgentConfig | null> {
  const { data, error } = await db
    .from("agent_configs")
    .select("*")
    .eq("id", configId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeConfig(data);
}

// PR-AGENT-INTEGRATION-3 (mai/2026): roteamento multi-agente.
//
// Pra cada msg que chega:
//   1. Procura agent_conversation existente pra esse CRM conversation
//      (sem filtrar por config_id — stickiness).
//   2. Se existe → carrega esse config (lead "fica preso" no agente que
//      pegou ele primeiro).
//   3. Senao (1a msg): carrega leadState (tags, segments, stage, status),
//      busca agentes secundarios + suas conditions, avalia OR+priority.
//      Se algum bate → usa esse secundario. Senao → usa principal.
//
// Idempotente em re-execucao. Falhas (DB error) caem pro principal pra
// nao bloquear o agente nativo.
export async function pickAgentForConversation(params: {
  db: AgentDb;
  orgId: string;
  crmConversationId: string;
  leadId: string;
  messageText: string;
  primary: AgentConfig;
}): Promise<AgentConfig> {
  const { db, orgId, crmConversationId, leadId, messageText, primary } = params;

  // 1. Stickiness: lookup por (org, crm_conversation_id) sem filtrar
  //    config_id. Se ja foi roteado pra X, mantem X.
  const { data: existing } = await db
    .from("agent_conversations")
    .select("config_id")
    .eq("organization_id", orgId)
    .eq("crm_conversation_id", crmConversationId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const stuckConfigId = (existing as { config_id?: string | null }).config_id;
    if (stuckConfigId) {
      const stuckConfig = await loadAgentConfigById(db, orgId, stuckConfigId);
      if (stuckConfig && stuckConfig.status === "active") return stuckConfig;
      // Se config sumiu/inativo, cai pro routing — re-rotar e melhor que
      // travar a conversa.
    }
  }

  // 2. Lead state pra avaliacao das conditions (tags, segments, stage,
  //    status). Best-effort: erros caem pro primary.
  const leadState = {
    tags: [] as string[],
    segment_ids: [] as string[],
    pipeline_stage_id: null as string | null,
    status: null as string | null,
  };
  try {
    const [leadRes, tagsRes, segmentsRes] = await Promise.all([
      db
        .from("leads")
        .select("status, stage_id")
        .eq("organization_id", orgId)
        .eq("id", leadId)
        .maybeSingle(),
      db
        .from("lead_tags")
        .select("tags(name)")
        .eq("lead_id", leadId),
      db
        .from("lead_segments")
        .select("segment_id")
        .eq("lead_id", leadId),
    ]);

    const lead = leadRes.data as {
      status?: string | null;
      stage_id?: string | null;
    } | null;
    if (lead) {
      leadState.status = lead.status ?? null;
      leadState.pipeline_stage_id = lead.stage_id ?? null;
    }

    leadState.tags = ((tagsRes.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const tag = row.tags as Record<string, unknown> | null;
        const name = tag?.name;
        return typeof name === "string" ? name.trim().toLowerCase() : null;
      })
      .filter((s): s is string => Boolean(s));

    leadState.segment_ids = ((segmentsRes.data ?? []) as Array<{
      segment_id?: string;
    }>)
      .map((row) => row.segment_id)
      .filter((s): s is string => Boolean(s));
  } catch {
    // Best-effort: deixa leadState vazio. Conditions de tag/segment
    // simplesmente nao casam, fallback pro principal.
  }

  // 3. Carrega agentes secundarios + conditions. Best-effort: qualquer
  // erro (table 045 nao migrada, query bug, mock incompleto em test) cai
  // pro primary. O design e: rotear SO funciona quando esta tudo certo;
  // do contrario, comportamento legado (1 agente principal sempre).
  try {
    const { data: secondaries, error: secondariesError } = await db
      .from("agent_configs")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .eq("is_primary", false)
      .neq("id", primary.id);

    if (secondariesError) return primary;

    const secondaryAgents = ((secondaries ?? []) as Array<Record<string, unknown>>).map(
      (row) => normalizeConfig(row),
    );

    if (secondaryAgents.length === 0) return primary;

    const { data: conditionsData, error: conditionsError } = await db
      .from("agent_entry_conditions")
      .select("*")
      .eq("organization_id", orgId)
      .in(
        "agent_config_id",
        secondaryAgents.map((a) => a.id),
      );

    if (conditionsError) return primary;

    const conditions = (conditionsData ?? []) as Array<{
      agent_config_id: string;
      condition_type: import("@persia/shared/ai-agent").EntryConditionType;
      condition_value: import("@persia/shared/ai-agent").EntryConditionValue;
      priority: number;
      created_at: string;
    }>;

    if (conditions.length === 0) return primary;

    // Agrupa conditions por agent_config_id pra montar candidates.
    type ConditionRow = (typeof conditions)[number];
    const conditionsByAgent = new Map<string, ConditionRow[]>();
    for (const cond of conditions) {
      const bucket = conditionsByAgent.get(cond.agent_config_id) ?? [];
      bucket.push(cond);
      conditionsByAgent.set(cond.agent_config_id, bucket);
    }

    const { pickSecondaryAgent } = await import("@persia/shared/ai-agent");
    const candidates = secondaryAgents.map((agent) => ({
      agent,
      conditions: conditionsByAgent.get(agent.id) ?? [],
    }));

    const picked = pickSecondaryAgent(candidates, leadState, messageText);
    return picked ?? primary;
  } catch {
    return primary;
  }
}

export async function resolveAgentContext(params: {
  db: AgentDb;
  orgId: string;
  msg: IncomingMessage;
  config: AgentConfig;
  // PR-AGENT-INTEGRATION-3: caller pode pre-criar CRM context pra
  // evitar dupla chamada quando ja rodou routing (pickAgentForConversation
  // precisa do crm.leadId + crm.crmConversationId).
  precrm?: RuntimeCrmContext;
}): Promise<ResolvedAgentContext> {
  const crm = params.precrm
    ? params.precrm
    : await ensureCrmContext(params.db, params.orgId, params.msg);
  const agentConversation = await ensureAgentConversation({
    db: params.db,
    orgId: params.orgId,
    config: params.config,
    crm,
  });
  const stage = await loadStage(
    params.db,
    params.orgId,
    params.config.id,
    agentConversation.current_stage_id,
  );
  const tools = stage
    ? await loadAllowedTools(params.db, params.orgId, params.config.id, stage.id)
    : [];

  return { config: params.config, stage, agentConversation, tools, crm };
}

export async function ensureCrmContext(
  db: AgentDb,
  orgId: string,
  msg: IncomingMessage,
): Promise<RuntimeCrmContext> {
  // PR-AI-AGENT-PIPELINE-FIX (mai/2026): normalize phone via Zod E.164
  // antes do lookup/insert. Paridade com processIncomingMessage (PR-A
  // LEADFIX). Sem isso, UAZAPI ("+5511...") e Meta ("5511...") criavam
  // leads duplicados pro mesmo contato quando native agent rodava.
  let normalizedPhone = msg.phone;
  try {
    normalizedPhone = phoneBR.parse(msg.phone);
  } catch (err) {
    logError("ensure_crm_context_phone_normalize_failed", {
      organization_id: orgId,
      raw_phone: msg.phone,
      error: errorMessage(err),
    });
  }

  let { data: lead } = await db
    .from("leads")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (!lead) {
    const { data: newLead, error } = await db
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
    if (error || !newLead) throw new Error(error?.message || "failed to create lead");
    lead = newLead;
  }

  let { data: conversation } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id)
    .in("status", ["active", "waiting_human"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: newConversation, error } = await db
      .from("conversations")
      .insert({
        organization_id: orgId,
        lead_id: lead.id,
        channel: "whatsapp",
        status: "active",
        assigned_to: "ai",
        last_message_at: nowIso(),
      })
      .select("id")
      .single();
    if (error || !newConversation) {
      throw new Error(error?.message || "failed to create conversation");
    }
    conversation = newConversation;
  }

  let inboundMessageId: string | null = null;
  if (msg.messageId) {
    const { data: existing } = await db
      .from("messages")
      .select("id")
      .eq("organization_id", orgId)
      .eq("whatsapp_msg_id", msg.messageId)
      .maybeSingle();
    inboundMessageId = existing?.id ?? null;
  }

  if (!inboundMessageId) {
    const { data: message, error } = await db
      .from("messages")
      .insert({
        organization_id: orgId,
        conversation_id: conversation.id,
        lead_id: lead.id,
        content: msg.text,
        sender: "lead",
        type: msg.type,
        whatsapp_msg_id: msg.messageId,
        media_url: msg.mediaUrl || null,
        media_type: msg.mediaMimeType || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    inboundMessageId = message?.id ?? null;
  }

  await db
    .from("conversations")
    .update({ last_message_at: nowIso(), updated_at: nowIso() })
    .eq("id", conversation.id)
    .eq("organization_id", orgId);

  return {
    leadId: lead.id,
    crmConversationId: conversation.id,
    inboundMessageId,
  };
}

async function ensureAgentConversation(params: {
  db: AgentDb;
  orgId: string;
  config: AgentConfig;
  crm: RuntimeCrmContext;
}): Promise<AgentConversation> {
  const { data: existing } = await params.db
    .from("agent_conversations")
    .select("*")
    .eq("organization_id", params.orgId)
    .eq("crm_conversation_id", params.crm.crmConversationId)
    .eq("config_id", params.config.id)
    .maybeSingle();

  if (existing) return normalizeConversation(existing);

  const firstStage = await loadStage(params.db, params.orgId, params.config.id, null);
  const { data, error } = await params.db
    .from("agent_conversations")
    .insert({
      organization_id: params.orgId,
      crm_conversation_id: params.crm.crmConversationId,
      lead_id: params.crm.leadId,
      config_id: params.config.id,
      current_stage_id: firstStage?.id ?? null,
      variables: {},
      last_interaction_at: nowIso(),
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "failed to create agent conversation");
  return normalizeConversation(data);
}

export async function createSyntheticAgentConversation(params: {
  db: AgentDb;
  orgId: string;
  config: AgentConfig;
  stageId: string | null;
  state?: {
    history_summary: string | null;
    variables: Record<string, unknown>;
  };
}): Promise<AgentConversation> {
  const stage = params.stageId
    ? await loadStage(params.db, params.orgId, params.config.id, params.stageId)
    : await loadStage(params.db, params.orgId, params.config.id, null);
  const { data, error } = await params.db
    .from("agent_conversations")
    .insert({
      organization_id: params.orgId,
      crm_conversation_id: null,
      lead_id: null,
      config_id: params.config.id,
      current_stage_id: stage?.id ?? null,
      history_summary: params.state?.history_summary ?? null,
      variables: params.state?.variables ?? {},
      last_interaction_at: nowIso(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "failed to create tester conversation");
  }
  return normalizeConversation(data);
}

export async function loadStage(
  db: AgentDb,
  orgId: string,
  configId: string,
  stageId: string | null,
): Promise<AgentStage | null> {
  let query = db
    .from("agent_stages")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId);

  if (stageId) {
    query = query.eq("id", stageId).maybeSingle();
  } else {
    query = query.order("order_index", { ascending: true }).limit(1).maybeSingle();
  }

  const { data, error } = await query;
  if (error || !data) return null;
  return normalizeStage(data);
}

export async function loadAllowedTools(
  db: AgentDb,
  orgId: string,
  configId: string,
  stageId: string,
): Promise<AgentTool[]> {
  const { data: allowedRows } = await db
    .from("agent_stage_tools")
    .select("tool_id")
    .eq("organization_id", orgId)
    .eq("stage_id", stageId)
    .eq("is_enabled", true);

  const allowedIds = new Set((allowedRows ?? []).map((row: { tool_id: string }) => row.tool_id));
  if (allowedIds.size === 0) return [];

  const { data } = await db
    .from("agent_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .eq("is_enabled", true);

  return (data ?? [])
    .filter((tool: { id: string }) => allowedIds.has(tool.id))
    .map(normalizeTool);
}

export async function updateConversationUsage(params: {
  db: AgentDb;
  orgId: string;
  agentConversationId: string;
  tokensInput: number;
  tokensOutput: number;
}): Promise<void> {
  const { data } = await params.db
    .from("agent_conversations")
    .select("tokens_used_total, variables")
    .eq("id", params.agentConversationId)
    .eq("organization_id", params.orgId)
    .maybeSingle();

  const total = Number(data?.tokens_used_total ?? 0) + params.tokensInput + params.tokensOutput;
  await params.db
    .from("agent_conversations")
    .update({
      tokens_used_total: total,
      variables: mergeJsonObject(data?.variables, {}),
      last_interaction_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", params.agentConversationId)
    .eq("organization_id", params.orgId);
}

export async function incrementConversationSummaryCounters(params: {
  db: AgentDb;
  orgId: string;
  conversation: AgentConversation;
  tokensInput: number;
  tokensOutput: number;
}): Promise<AgentConversation> {
  const nextConversation = normalizeConversation({
    ...params.conversation,
    history_summary_run_count: Number(params.conversation.history_summary_run_count ?? 0) + 1,
    history_summary_token_count:
      Number(params.conversation.history_summary_token_count ?? 0) +
      params.tokensInput +
      params.tokensOutput,
    updated_at: nowIso(),
  });

  await params.db
    .from("agent_conversations")
    .update({
      history_summary_run_count: nextConversation.history_summary_run_count,
      history_summary_token_count: nextConversation.history_summary_token_count,
      updated_at: nextConversation.updated_at,
    })
    .eq("id", params.conversation.id)
    .eq("organization_id", params.orgId);

  return nextConversation;
}

export async function persistConversationSummary(params: {
  db: AgentDb;
  orgId: string;
  conversationId: string;
  historySummary: string;
  updatedAt?: string;
}): Promise<void> {
  const updatedAt = params.updatedAt ?? nowIso();
  await params.db
    .from("agent_conversations")
    .update({
      history_summary: params.historySummary,
      history_summary_updated_at: updatedAt,
      history_summary_run_count: 0,
      history_summary_token_count: 0,
      updated_at: updatedAt,
    })
    .eq("id", params.conversationId)
    .eq("organization_id", params.orgId);
}

function normalizeConfig(row: Record<string, unknown>): AgentConfig {
  return {
    ...(row as unknown as AgentConfig),
    guardrails: normalizeGuardrails(row.guardrails),
    debounce_window_ms: clampDebounceWindowMs(
      typeof row.debounce_window_ms === "number" ? row.debounce_window_ms : undefined,
    ),
    context_summary_turn_threshold: clampTurnThreshold(
      typeof row.context_summary_turn_threshold === "number"
        ? row.context_summary_turn_threshold
        : undefined,
    ),
    context_summary_token_threshold: clampTokenThreshold(
      typeof row.context_summary_token_threshold === "number"
        ? row.context_summary_token_threshold
        : undefined,
    ),
    context_summary_recent_messages: clampRecentMessagesCount(
      typeof row.context_summary_recent_messages === "number"
        ? row.context_summary_recent_messages
        : undefined,
    ),
  };
}

function normalizeStage(row: Record<string, unknown>): AgentStage {
  return row as unknown as AgentStage;
}

function normalizeTool(row: Record<string, unknown>): AgentTool {
  return row as unknown as AgentTool;
}

function normalizeConversation(row: Record<string, unknown>): AgentConversation {
  return {
    ...(row as unknown as AgentConversation),
    history_summary_updated_at:
      typeof row.history_summary_updated_at === "string" ? row.history_summary_updated_at : null,
    history_summary_run_count: Number(row.history_summary_run_count ?? 0),
    history_summary_token_count: Number(row.history_summary_token_count ?? 0),
    variables: asRecord(row.variables),
  };
}
