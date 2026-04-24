import type {
  AgentConfig,
  AgentConversation,
  AgentStage,
  AgentTool,
} from "@persia/shared/ai-agent";
import { clampDebounceWindowMs } from "@persia/shared/ai-agent";
import type { IncomingMessage } from "@/lib/whatsapp/provider";
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

export async function resolveAgentContext(params: {
  db: AgentDb;
  orgId: string;
  msg: IncomingMessage;
  config: AgentConfig;
}): Promise<ResolvedAgentContext> {
  const crm = await ensureCrmContext(params.db, params.orgId, params.msg);
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
  let { data: lead } = await db
    .from("leads")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone", msg.phone)
    .maybeSingle();

  if (!lead) {
    const { data: newLead, error } = await db
      .from("leads")
      .insert({
        organization_id: orgId,
        phone: msg.phone,
        name: msg.pushName || msg.phone,
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

function normalizeConfig(row: Record<string, unknown>): AgentConfig {
  return {
    ...(row as unknown as AgentConfig),
    guardrails: normalizeGuardrails(row.guardrails),
    debounce_window_ms: clampDebounceWindowMs(
      typeof row.debounce_window_ms === "number" ? row.debounce_window_ms : undefined,
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
    variables: asRecord(row.variables),
  };
}
