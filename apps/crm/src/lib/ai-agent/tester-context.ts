import "server-only";

import type { IncomingMessage } from "@/lib/whatsapp/provider";
import { type AgentDb } from "./db";

// PR-AI-AGENT-TESTER-FAITHFUL (mai/2026): contexto sintetico do Tester
// fiel. Cria um lead "Tester" persistente por org pra rodar o pipeline
// REAL (tryEnqueueForNativeAgent + executeDebouncedBatch) com provider
// stub. Lead escondido das UIs via metadata.is_test=true (filtros em
// listLeadsKanban + getLeads).
//
// Idempotente: select-first, insert se ausente. Race entre 2 testers
// simultaneos na mesma org pode falhar no insert (unique constraint
// org_id+phone) — caso raro, deixa o erro propagar e a UI mostra toast.

// Phone reservado: prefixo "+5500" + 9 zeros + 2 digitos derivados do
// orgId (apenas digitos pra passar phoneBR.refine). Distinto o suficiente
// pra nao colidir com nenhum lead real (orgs nao tem clientes com DDD 00).
// phoneBR.parse vai aplicar `+55` se 10/11 digitos — entrada ja vem com
// "+55" pra evitar a normalizacao.
const TESTER_PHONE_PREFIX = "+5500000000";

/** Phone do lead Tester para esta org. Deterministico. */
export function testerPhoneForOrg(orgId: string): string {
  // 2 digitos extra derivados do orgId (hash simples) pra evitar
  // colisao improvavel entre orgs (caso o lookup escape o filtro de
  // organization_id por bug).
  const digits = orgId.replace(/\D/g, "").slice(0, 2).padEnd(2, "0");
  return `${TESTER_PHONE_PREFIX}${digits}`;
}

export interface TesterContext {
  leadId: string;
  crmConversationId: string;
}

/**
 * Garante que existe lead+conversation "Tester" para a org. Idempotente.
 * Reusa entre runs do Tester pra preservar stickiness (agent_conversations)
 * + state (variables, current_stage_id, human_handoff_at).
 *
 * Lead e marcado com `metadata.is_test=true` pra ser escondido dos
 * filtros de Kanban/Leads.
 */
export async function ensureTesterContext(
  db: AgentDb,
  orgId: string,
): Promise<TesterContext> {
  const phone = testerPhoneForOrg(orgId);

  // ----- LEAD -----
  let { data: lead } = await db
    .from("leads")
    .select("id, metadata, assigned_to")
    .eq("organization_id", orgId)
    .eq("phone", phone)
    .maybeSingle();

  // PR-FIX-TESTER-ASSIGNED-TO (mai/2026): create_appointment exige
  // lead.assigned_to setado (responsavel da reuniao). Tester precisa
  // herdar um membro ativo qualquer da org pra que IA consiga simular
  // agendamento fielmente sem o handler retornar "lead nao tem
  // responsavel atribuido".
  let defaultAssignee: string | null = null;
  const { data: members } = await db
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1);
  if (members && members.length > 0) {
    defaultAssignee = (members[0] as { user_id?: string | null }).user_id ?? null;
  }

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
    // Defensivo: se lead foi criado manualmente antes (rollout), garante
    // a flag metadata.is_test pra que os filtros escondam + assigned_to.
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

  return { leadId: lead.id, crmConversationId: conv.id };
}

/**
 * Apaga TODO o state do Tester pra esta org: messages, agent_runs,
 * agent_steps, pending_messages, agent_conversations. Preserva o lead
 * + crm_conversation (sao recriados na proxima chamada do tester).
 *
 * Usado pelo botao "Resetar conversa" do Tester. Cliente quer voltar
 * pra etapa inicial sem human_handoff_at residual, sem variables
 * acumuladas, etc.
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
  if (!lead) return; // nada pra resetar

  // Conversations e agent_conversations sao apagados em cascade via
  // FK quando o lead some — mas a gente NAO apaga o lead. Vamos apagar
  // explicitamente cada tabela.
  const { data: convs } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id);
  const convIds = ((convs ?? []) as Array<{ id: string }>).map((c) => c.id);

  // agent_conversations sao por lead_id (nao por crm conversation_id).
  // Pegando agent_convs antes pra cascade em agent_runs/steps.
  const { data: agentConvs } = await db
    .from("agent_conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", lead.id);
  const agentConvIds = ((agentConvs ?? []) as Array<{ id: string }>).map(
    (c) => c.id,
  );

  if (agentConvIds.length > 0) {
    // pending_messages, agent_runs (e via cascade agent_steps)
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

/**
 * Constroi um IncomingMessage sintetico pra passar pro pipeline real
 * (tryEnqueueForNativeAgent). Phone, pushName e messageId determinisicos
 * o suficiente pra que ensureCrmContext encontre o lead Tester existente.
 */
export function buildTesterIncomingMessage(
  orgId: string,
  text: string,
): IncomingMessage {
  return {
    phone: testerPhoneForOrg(orgId),
    pushName: "Tester",
    text,
    type: "text",
    messageId: `tester-${crypto.randomUUID()}`,
    isGroup: false,
    isFromMe: false,
    timestamp: Date.now(),
  } as IncomingMessage;
}
