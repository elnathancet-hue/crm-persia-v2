"use server";

import type {
  AgentRunSummary,
  LeadAgentActivitySummary,
  LeadAgentStatus,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";

// PR-AGENT-INTEGRATION-5 (mai/2026): visibilidade reversa do AI Agent
// dentro do LeadDrawer. Operador humano abre lead no CRM e ve:
//   - Qual agente esta respondendo (ou null se nenhum)
//   - Status (ativo / pausado por humano)
//   - Botoes pausar/reativar manual
//   - Lista de runs recentes (top 5)
//   - Trilha de lead_activities filtrado por source=ai_agent (top 10)

const RUNS_LIMIT_DEFAULT = 5;
const ACTIVITIES_LIMIT_DEFAULT = 10;

/**
 * Le status do agente respondendo este lead. Retorna null quando o
 * lead nunca foi tocado pelo agente (sem agent_conversations row).
 *
 * Stickiness: existe so 1 agent_conversation ativa por crm_conversation,
 * entao a query pega a mais recente desse lead.
 */
export async function getLeadAgentStatus(
  leadId: string,
): Promise<LeadAgentStatus | null> {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("agent_conversations")
    .select(
      "id, config_id, crm_conversation_id, human_handoff_at, last_interaction_at, agent_configs(name)",
    )
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    id: string;
    config_id: string;
    crm_conversation_id: string;
    human_handoff_at: string | null;
    last_interaction_at: string | null;
    agent_configs: { name?: string } | { name?: string }[] | null;
  };

  // supabase pode retornar relation como array ou objeto dependendo
  // da config — normaliza pra string.
  const agentConfigs = Array.isArray(row.agent_configs)
    ? row.agent_configs[0]
    : row.agent_configs;
  const configName = agentConfigs?.name ?? "Agente sem nome";

  return {
    agent_conversation_id: row.id,
    config_id: row.config_id,
    config_name: configName,
    paused_at: row.human_handoff_at,
    last_interaction_at: row.last_interaction_at,
    crm_conversation_id: row.crm_conversation_id,
  };
}

/**
 * Pausa o agente manualmente (operador clicou "Pausar" no LeadDrawer).
 * Idempotente — se ja pausado, no-op.
 */
export async function pauseLeadAgent(agentConversationId: string): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");

  const { error } = await supabase
    .from("agent_conversations")
    .update({
      human_handoff_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .eq("id", agentConversationId);

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
}

/**
 * Reativa o agente manualmente. Limpa human_handoff_at —
 * proxima msg do lead volta a ser processada pela IA.
 */
export async function resumeLeadAgent(agentConversationId: string): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");

  const { error } = await supabase
    .from("agent_conversations")
    .update({
      human_handoff_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .eq("id", agentConversationId);

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
}

/**
 * Lista os ultimos N runs do agente neste lead (sem steps). Pra render
 * de cards compactos. Reusa filtro lead_id que agent_runs ja tem (via
 * audit.ts listRuns), mas com colunas minimas.
 */
export async function listLeadAgentRuns(
  leadId: string,
  limit: number = RUNS_LIMIT_DEFAULT,
): Promise<AgentRunSummary[]> {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("agent_runs")
    .select("id, status, model, duration_ms, created_at, error_msg, agent_conversation_id, agent_conversations!inner(lead_id, organization_id)")
    .eq("agent_conversations.organization_id", orgId)
    .eq("agent_conversations.lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    status: row.status as AgentRunSummary["status"],
    model: (row.model as string) ?? "unknown",
    duration_ms: (row.duration_ms as number) ?? 0,
    created_at: row.created_at as string,
    error_msg: (row.error_msg as string | null) ?? null,
  }));
}

/**
 * Lista as ultimas N atividades do lead onde source=ai_agent. Filtra
 * via metadata->>'source' (gin index ja existe). Description vem em
 * PT preenchido pelos handlers (add_tag/move_pipeline/etc).
 */
export async function listLeadAgentActivities(
  leadId: string,
  limit: number = ACTIVITIES_LIMIT_DEFAULT,
): Promise<LeadAgentActivitySummary[]> {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("lead_activities")
    .select("id, type, description, created_at, metadata")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .filter("metadata->>source", "eq", "ai_agent")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    type: row.type as string,
    description: (row.description as string) ?? "",
    created_at: row.created_at as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));
}
