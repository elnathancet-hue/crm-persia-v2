import "server-only";

// AI Agent — contexto do Tester (lead + conversation + agent_conversation
// de teste). PR-FLOW-PIVOT PR 2 (mai/2026): recriado adaptado pro novo
// modelo (current_node_id em vez de current_stage_id). Reusa o phone
// reservado "+5500" + sufixo derivado do orgId — mesmo padrão do
// tester-context.ts pré-pivot.
//
// Idempotente: select-first, insert se ausente. Lead marcado com
// metadata.is_test=true pra ficar escondido dos filtros de Kanban/Leads.

import type { AgentDb } from "../db";

const TESTER_PHONE_PREFIX = "+5500000000";

/** Phone determinístico do lead Tester por org. */
export function testerPhoneForOrg(orgId: string): string {
  const digits = orgId.replace(/\D/g, "").slice(0, 2).padEnd(2, "0");
  return `${TESTER_PHONE_PREFIX}${digits}`;
}

export interface TesterContext {
  leadId: string;
  crmConversationId: string;
  agentConversationId: string;
  /** current_node_id no início do turno — runner usa pra retomar. NULL na
   * primeira mensagem (entry node entra em ação). */
  currentNodeId: string | null;
}

/**
 * Garante lead + conversation + agent_conversation pra rodar o Tester.
 * Idempotente — chamadas subsequentes reusam o mesmo lead/conversation
 * pra preservar state (current_node_id, history_summary, variables).
 */
export async function ensureTesterContext(
  db: AgentDb,
  orgId: string,
  agentConfigId: string,
): Promise<TesterContext> {
  const phone = testerPhoneForOrg(orgId);

  // Default assignee — pegamos qualquer membro ativo da org pra setar
  // como responsável do lead (necessário pra alguns handlers como
  // create_appointment validarem).
  const { data: members } = await db
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1);
  const defaultAssignee =
    members && members.length > 0
      ? ((members[0] as { user_id?: string | null }).user_id ?? null)
      : null;

  // ----- LEAD -----
  let { data: lead } = await db
    .from("leads")
    .select("id, metadata, assigned_to")
    .eq("organization_id", orgId)
    .eq("phone", phone)
    .maybeSingle();

  if (!lead) {
    const { data: newLead, error } = await db
      .from("leads")
      .insert({
        organization_id: orgId,
        phone,
        name: "Tester",
        source: "system",
        status: "new",
        channel: "whatsapp",
        assigned_to: defaultAssignee,
        metadata: { is_test: true, created_by: "ai_agent_tester" },
      })
      .select("id, metadata, assigned_to")
      .single();
    if (error || !newLead) {
      throw new Error(`failed to create tester lead: ${error?.message}`);
    }
    lead = newLead;
  } else {
    const md = (lead.metadata as Record<string, unknown> | null) ?? {};
    const updates: Record<string, unknown> = {};
    if (md.is_test !== true) {
      updates.metadata = { ...md, is_test: true, created_by: "ai_agent_tester" };
    }
    const leadRow = lead as { assigned_to?: string | null };
    if (!leadRow.assigned_to && defaultAssignee) {
      updates.assigned_to = defaultAssignee;
    }
    if (Object.keys(updates).length > 0) {
      await db.from("leads").update(updates).eq("id", lead.id);
    }
  }

  // ----- CONVERSATION (CRM) -----
  let { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id)
    .in("status", ["active", "waiting_human"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conv) {
    const { data: newConv, error } = await db
      .from("conversations")
      .insert({
        organization_id: orgId,
        lead_id: lead.id,
        channel: "whatsapp",
        status: "active",
        assigned_to: "ai",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !newConv) {
      throw new Error(`failed to create tester conversation: ${error?.message}`);
    }
    conv = newConv;
  }

  // ----- AGENT_CONVERSATION -----
  let { data: agentConv } = await db
    .from("agent_conversations")
    .select("id, current_node_id")
    .eq("organization_id", orgId)
    .eq("config_id", agentConfigId)
    .eq("lead_id", lead.id)
    .eq("crm_conversation_id", conv.id)
    .maybeSingle();

  if (!agentConv) {
    const { data: newAgentConv, error } = await db
      .from("agent_conversations")
      .insert({
        organization_id: orgId,
        config_id: agentConfigId,
        lead_id: lead.id,
        crm_conversation_id: conv.id,
        current_node_id: null,
        variables: {},
        actions_executed: [],
        actions_executed_detail: {},
      })
      .select("id, current_node_id")
      .single();
    if (error || !newAgentConv) {
      throw new Error(
        `failed to create tester agent_conversation: ${error?.message}`,
      );
    }
    agentConv = newAgentConv;
  }

  return {
    leadId: lead.id,
    crmConversationId: conv.id,
    agentConversationId: agentConv.id,
    currentNodeId: (agentConv as { current_node_id: string | null })
      .current_node_id,
  };
}

/**
 * Apaga state do Tester pra esta org/agente: messages, agent_runs,
 * agent_conversations vinculados ao lead Tester. Preserva lead +
 * crm_conversation (recriados nos próximos turns).
 */
export async function resetTesterConversation(
  db: AgentDb,
  orgId: string,
): Promise<void> {
  const phone = testerPhoneForOrg(orgId);
  const { data: lead } = await db
    .from("leads")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone", phone)
    .maybeSingle();
  if (!lead) return;

  const { data: convs } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id);
  const convIds = ((convs ?? []) as Array<{ id: string }>).map((c) => c.id);

  const { data: agentConvs } = await db
    .from("agent_conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id);
  const agentConvIds = ((agentConvs ?? []) as Array<{ id: string }>).map(
    (c) => c.id,
  );

  if (agentConvIds.length > 0) {
    await db
      .from("pending_messages")
      .delete()
      .in("agent_conversation_id", agentConvIds);
    await db
      .from("agent_runs")
      .delete()
      .in("agent_conversation_id", agentConvIds);
    await db.from("agent_conversations").delete().in("id", agentConvIds);
  }

  if (convIds.length > 0) {
    await db.from("messages").delete().in("conversation_id", convIds);
    await db.from("conversations").delete().in("id", convIds);
  }
}

/** Persiste current_node_id ao fim de um turno. */
export async function persistCurrentNode(
  db: AgentDb,
  orgId: string,
  agentConversationId: string,
  nodeId: string | null,
): Promise<void> {
  const { error } = await db
    .from("agent_conversations")
    .update({
      current_node_id: nodeId,
      last_interaction_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .eq("id", agentConversationId);
  if (error) {
    throw new Error(`failed to persist current_node_id: ${error.message}`);
  }
}
