// AI Agent — runtime hooks pra disparar flows a partir de eventos CRM.
//
// PR-FLOW-PIVOT PR 11 (mai/2026): quando o lead/deal muda de stage no
// Kanban (ou via AI), dispara TODOS os flows cujo entry node declara
// `pipeline_stage_entered { stage_id }` casando com a stage de destino.
// Roda fire-and-forget (callers usam `void`) — falha não derruba a
// transação de stage change.
//
// Arquitetura:
//   1. Caller (move-pipeline-stage.ts / leads-kanban.ts action) chama
//      `triggerAgentFlowsForStageEntry(supabase, orgId, leadId, stageId)`
//      DEPOIS do UPDATE de stage commitar
//   2. Função carrega TODOS os flows da org com trigger correspondente
//   3. Filtra por entry.config.stage_id === stageId (string compare)
//   4. Pra cada match: monta contexto, carrega provider WhatsApp, e
//      executa o flow do entry node (synthetic empty inbound)
//
// Limitações V1 (intencionais):
//   - segment_entered NÃO é suportado (sem tabela segment_members; PR 12)
//   - Sem dedup: se cliente arrastar lead de A→B→A→B, dispara 2x.
//     Aceitável V1 — flows típicos são idempotentes (envia msg, segue)
//   - Sem audit em agent_runs (tokens=0 pra triggers, IA não roda em V1)
//   - Hook só roda em transições COMMITADAS (chamada explícita após o
//     UPDATE), não via PG trigger — evita problemas de re-entrância
//
// Por que NÃO usa pending_messages + debounce:
//   - Esse evento já é "discreto" (1 evento = 1 transição). Não há ping
//     do usuário pra agregar.
//   - Cliente espera resposta RÁPIDA (lead acabou de virar
//     "Qualificado", manda boas-vindas AGORA). Debounce de 10s atrasaria.

import { createProvider } from "@persia/shared/providers";
import { OPEN_CONVERSATION_STATUSES } from "@persia/shared/crm";
import { normalizeHumanizationConfig } from "@persia/shared/ai-agent";
import { errorMessage, logError } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "../db";
import { loadFlowsByEntryTrigger, type LoadedFlow } from "./loader";
import { createRealtimeProvider } from "./realtime-provider";
import { runFlow } from "./runner";
import type { FlowRunContext } from "./types";

// ============================================================================
// Public API
// ============================================================================

/**
 * Hook chamado APÓS uma transição de stage do lead/deal commitar.
 * Dispara flows ativos da org com entry trigger
 * `pipeline_stage_entered { stage_id: stageId }`.
 *
 * Fire-and-forget: caller deve envolver em `void` e capturar erros.
 * Função internamente captura erros individuais por flow pra evitar
 * que 1 flow quebrado bloqueie os outros.
 */
export async function triggerAgentFlowsForStageEntry(
  supabaseOrAgentDb: AgentDb | { from: (table: string) => unknown },
  orgId: string,
  leadId: string,
  stageId: string,
): Promise<{ triggered: number; skipped: number; failed: number }> {
  const db = asAgentDb(supabaseOrAgentDb as AgentDb);
  const logCtx = {
    organization_id: orgId,
    lead_id: leadId,
    stage_id: stageId,
    trigger_type: "pipeline_stage_entered" as const,
  };

  let flows: LoadedFlow[];
  try {
    flows = await loadFlowsByEntryTrigger(
      db,
      orgId,
      "pipeline_stage_entered",
    );
  } catch (err) {
    logError("trigger_load_flows_failed", {
      ...logCtx,
      error: errorMessage(err),
    });
    return { triggered: 0, skipped: 0, failed: 0 };
  }

  if (flows.length === 0) {
    return { triggered: 0, skipped: 0, failed: 0 };
  }

  // Filtra flows cuja entry.config.stage_id casa com a stage atual.
  const matching = flows.filter((flow) => {
    const entry = flow.config.nodes.find((n) => n.type === "entry");
    if (!entry || entry.type !== "entry") return false;
    const configStageId = (entry.data.config as { stage_id?: unknown } | undefined)
      ?.stage_id;
    return typeof configStageId === "string" && configStageId === stageId;
  });

  if (matching.length === 0) {
    return { triggered: 0, skipped: 0, failed: 0 };
  }

  let triggered = 0;
  let skipped = 0;
  let failed = 0;
  for (const flow of matching) {
    try {
      const outcome = await executeFlowForLeadEvent({
        db,
        orgId,
        leadId,
        configId: flow.agent_config_id,
        flow,
        triggerType: "pipeline_stage_entered",
      });
      if (outcome === "ok") triggered++;
      else if (outcome === "skipped") skipped++;
      else failed++;
    } catch (err) {
      failed++;
      logError("trigger_run_flow_failed", {
        ...logCtx,
        config_id: flow.agent_config_id,
        error: errorMessage(err),
      });
    }
  }

  return { triggered, skipped, failed };
}

/**
 * PR-FLOW-PIVOT PR 12 (mai/2026): hook chamado APÓS lead entrar em
 * uma segmentação (membership recém-criada em `segment_memberships`).
 * Dispara flows ativos da org com entry trigger
 * `segment_entered { segment_id: segmentId }`.
 *
 * Fire-and-forget: caller (evaluator hook) envolve em void.
 */
export async function triggerAgentFlowsForSegmentEntry(
  supabaseOrAgentDb: AgentDb | { from: (table: string) => unknown },
  orgId: string,
  leadId: string,
  segmentId: string,
): Promise<{ triggered: number; skipped: number; failed: number }> {
  const db = asAgentDb(supabaseOrAgentDb as AgentDb);
  const logCtx = {
    organization_id: orgId,
    lead_id: leadId,
    segment_id: segmentId,
    trigger_type: "segment_entered" as const,
  };

  let flows: LoadedFlow[];
  try {
    flows = await loadFlowsByEntryTrigger(db, orgId, "segment_entered");
  } catch (err) {
    logError("trigger_load_flows_failed", {
      ...logCtx,
      error: errorMessage(err),
    });
    return { triggered: 0, skipped: 0, failed: 0 };
  }

  if (flows.length === 0) {
    return { triggered: 0, skipped: 0, failed: 0 };
  }

  const matching = flows.filter((flow) => {
    const entry = flow.config.nodes.find((n) => n.type === "entry");
    if (!entry || entry.type !== "entry") return false;
    const configSegmentId = (entry.data.config as { segment_id?: unknown } | undefined)
      ?.segment_id;
    return typeof configSegmentId === "string" && configSegmentId === segmentId;
  });

  if (matching.length === 0) {
    return { triggered: 0, skipped: 0, failed: 0 };
  }

  let triggered = 0;
  let skipped = 0;
  let failed = 0;
  for (const flow of matching) {
    try {
      const outcome = await executeFlowForLeadEvent({
        db,
        orgId,
        leadId,
        configId: flow.agent_config_id,
        flow,
        triggerType: "segment_entered",
      });
      if (outcome === "ok") triggered++;
      else if (outcome === "skipped") skipped++;
      else failed++;
    } catch (err) {
      failed++;
      logError("trigger_run_flow_failed", {
        ...logCtx,
        config_id: flow.agent_config_id,
        error: errorMessage(err),
      });
    }
  }

  return { triggered, skipped, failed };
}

// ============================================================================
// Internal: executa 1 flow disparado por evento CRM
// ============================================================================

interface ExecuteFlowForLeadEventInput {
  db: AgentDb;
  orgId: string;
  leadId: string;
  configId: string;
  flow: LoadedFlow;
  triggerType: "pipeline_stage_entered" | "segment_entered";
}

type FlowEventOutcome = "ok" | "skipped" | "failed";

/**
 * Executa 1 flow do entry node com synthetic empty inbound. Espelha
 * `executeDebouncedBatch` mas sem batch — caso de uso é dispatch
 * proativo (não responder a msg do lead).
 *
 * Strategy:
 *   1. Carrega lead phone + agent_config + whatsapp_connection
 *   2. Find OR create agent_conversation pra esse (config, lead)
 *      - Conversation CRM: reusa active se existir, senão cria nova
 *        com assigned_to="ai"
 *   3. Constrói realtime provider (envia WhatsApp real + persiste msgs)
 *   4. Roda runFlow começando do entry node (current_node_id=null força
 *      entry — ignoramos current_node_id antigo pra evitar continuação
 *      de turno anterior misturada com evento novo)
 *   5. Persiste current_node_id resultante
 */
async function executeFlowForLeadEvent(
  input: ExecuteFlowForLeadEventInput,
): Promise<FlowEventOutcome> {
  const { db, orgId, leadId, configId, flow, triggerType } = input;
  const logCtx = {
    organization_id: orgId,
    lead_id: leadId,
    config_id: configId,
    trigger_type: triggerType,
  };

  // 1. Loads paralelos.
  const [leadRes, configRes, connRes] = await Promise.all([
    db
      .from("leads")
      .select("phone")
      .eq("organization_id", orgId)
      .eq("id", leadId)
      .maybeSingle(),
    db
      .from("agent_configs")
      .select("id, model, system_prompt, humanization_config, status")
      .eq("organization_id", orgId)
      .eq("id", configId)
      .maybeSingle(),
    db
      .from("whatsapp_connections")
      // Cleanup (mai/2026): explicit field list — ver executor.ts.
      .select(
        "provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token",
      )
      .eq("organization_id", orgId)
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (leadRes.error || !leadRes.data) {
    logError("trigger_no_lead", logCtx);
    return "skipped";
  }
  const leadPhone = (leadRes.data as { phone: string | null }).phone;
  if (!leadPhone) {
    // Sem phone não dá pra enviar WhatsApp. Skip silencioso.
    return "skipped";
  }

  if (configRes.error || !configRes.data) {
    logError("trigger_no_config", logCtx);
    return "failed";
  }
  const agentConfig = configRes.data as {
    id: string;
    model: string;
    system_prompt: string;
    humanization_config?: unknown;
    status: string;
  };
  if (agentConfig.status !== "active") {
    return "skipped";
  }

  if (connRes.error || !connRes.data) {
    logError("trigger_no_connection", logCtx);
    return "failed";
  }
  const provider = createProvider(
    connRes.data as Parameters<typeof createProvider>[0],
  );
  const humanization = normalizeHumanizationConfig(
    agentConfig.humanization_config,
  );

  // 2. Find or create CRM conversation (assigned_to='ai').
  let { data: crmConvRow } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .in("status", [...OPEN_CONVERSATION_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!crmConvRow) {
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
      .select("id")
      .single();
    if (convErr || !newConv) {
      logError("trigger_conv_create_failed", {
        ...logCtx,
        error: convErr?.message,
      });
      return "failed";
    }
    crmConvRow = newConv;
  }
  const crmConversationId = (crmConvRow as { id: string }).id;

  // 3. Find or create agent_conversation.
  let { data: agentConvRow } = await db
    .from("agent_conversations")
    .select("id, ai_control_epoch")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .eq("lead_id", leadId)
    .eq("crm_conversation_id", crmConversationId)
    .maybeSingle();

  if (!agentConvRow) {
    const { data: newAgentConv, error: agentConvErr } = await db
      .from("agent_conversations")
      .insert({
        organization_id: orgId,
        config_id: configId,
        lead_id: leadId,
        crm_conversation_id: crmConversationId,
        current_node_id: null,
        variables: {},
        actions_executed: [],
        actions_executed_detail: {},
      })
      .select("id, ai_control_epoch")
      .single();
    if (agentConvErr || !newAgentConv) {
      logError("trigger_agent_conv_create_failed", {
        ...logCtx,
        error: agentConvErr?.message,
      });
      return "failed";
    }
    agentConvRow = newAgentConv;
  }
  const agentConversationId = (agentConvRow as { id: string }).id;
  const expectedControlEpoch =
    (agentConvRow as { ai_control_epoch?: number | null }).ai_control_epoch ?? 0;

  // 4. Build realtime provider + run context.
  const realtimeProvider = createRealtimeProvider({
    db,
    provider,
    leadPhone,
    leadId,
    conversationId: crmConversationId,
    organizationId: orgId,
    humanization,
    sendGuard: {
      db,
      organizationId: orgId,
      conversationId: crmConversationId,
      agentConversationId,
      expectedControlEpoch,
    },
  });

  const ctx: FlowRunContext = {
    flow,
    agentConfigId: configId,
    organizationId: orgId,
    crmConversationId,
    agentConversationId,
    leadId,
    inboundMessage: {
      // Synthetic: sem inbound de verdade. Runner detecta empty text e
      // pula LLM no AI node (guardrail). Flows pra eventos CRM devem
      // começar com action node (ex: Enviar mensagem WhatsApp).
      text: "",
      received_at: new Date().toISOString(),
    },
    provider: realtimeProvider,
    dryRun: false,
    flowConfig: flow.config,
  };

  // 5. Roda. Force startNodeId=null pra começar do entry (não continuar
  // de turno anterior — evento é discreto, não conversa em andamento).
  const result = await runFlow(db, ctx, null);

  // 6. Persiste current_node_id (caller pode querer continuar via
  // inbound depois).
  if (result.ending_node_id) {
    await db
      .from("agent_conversations")
      .update({
        current_node_id: result.ending_node_id,
        last_interaction_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", agentConversationId);
  }

  if (result.fatal_error) {
    logError("trigger_flow_fatal", { ...logCtx, error: result.fatal_error });
    return "failed";
  }
  return "ok";
}
