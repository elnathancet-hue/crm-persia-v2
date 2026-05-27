import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { failureResult, getHandlerDb, successResult, trimReason } from "./shared";

// PR-AI-AGENT-TOOLS-NAMES (mai/2026): aceita `target_agent_name` (nome
// amigavel do agente alvo, vindo do catalogo no system prompt) OU
// `agent_config_id` (UUID — retrocompat). Pelo menos um obrigatorio.
//
// PR-5 Auditoria (mai/2026): reescrito pro modelo flow (rodada 4 #critica).
// O handler antigo usava `agent_stages` + `current_stage_id` (modelo
// pre-pivot). Migration 054 dropou essas estruturas, entao o handler
// falhava em prod com "relation agent_stages does not exist".
//
// Novo modelo:
//   1. Troca `agent_conversations.config_id` pelo agente alvo.
//   2. Reseta `current_node_id = null` — proxima execucao comeca pelo
//      entry node do flow novo.
//   3. Bumpa `ai_control_epoch` — invalida qualquer run em flight do
//      agente anterior (send-guard rejeita).
//   4. Preserva `history_summary` e `variables` (continuidade contextual).
//   5. Valida que o agente alvo tem `agent_flows` (senao a proxima msg
//      do lead cai em flow_executor_no_flow).
const transferToAgentSchema = z.object({
  target_agent_name: z.string().trim().min(1).max(200).optional(),
  agent_config_id: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const transferToAgentHandler: NativeHandler = async (context, input) => {
  const parsed = transferToAgentSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  if (!parsed.data.target_agent_name && !parsed.data.agent_config_id) {
    return failureResult(
      "informe target_agent_name (recomendado) ou agent_config_id",
    );
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const reason = trimReason(parsed.data.reason, "agent_requested_agent_transfer");
  const { data: currentConversation, error: conversationError } = await db
    .from("agent_conversations")
    .select("config_id, current_node_id, history_summary, variables, ai_control_epoch")
    .eq("id", context.agent_conversation_id)
    .eq("organization_id", context.organization_id)
    .maybeSingle();

  if (conversationError) return failureResult(conversationError.message);
  if (!currentConversation) return failureResult("agent conversation not found");

  const currentRow = currentConversation as {
    config_id: string;
    current_node_id: string | null;
    history_summary: string | null;
    variables: unknown;
    ai_control_epoch?: number | null;
  };

  // Resolve agente alvo — UUID direto OU nome (case-insensitive,
  // restrito a agentes ATIVOS da mesma org, diferentes do atual).
  let resolvedConfigId: string | null = null;
  if (parsed.data.agent_config_id) {
    const { data: cfg, error } = await db
      .from("agent_configs")
      .select("id, status")
      .eq("id", parsed.data.agent_config_id)
      .eq("organization_id", context.organization_id)
      .maybeSingle();
    if (error) return failureResult(error.message);
    if (!cfg) return failureResult("target agent config not found");
    const cfgRow = cfg as { id: string; status: string };
    if (cfgRow.status !== "active") {
      return failureResult("target agent config must be active");
    }
    resolvedConfigId = cfgRow.id;
  } else if (parsed.data.target_agent_name) {
    const { data: cfg, error } = await db
      .from("agent_configs")
      .select("id")
      .eq("organization_id", context.organization_id)
      .eq("status", "active")
      .neq("id", currentRow.config_id)
      .ilike("name", parsed.data.target_agent_name)
      .limit(1)
      .maybeSingle();
    if (error) return failureResult(error.message);
    if (!cfg) {
      return failureResult("agente alvo nao encontrado", {
        requested: parsed.data.target_agent_name,
        hint: "use o nome EXATO da lista de agentes no contexto",
      });
    }
    resolvedConfigId = (cfg as { id: string }).id;
  }

  if (!resolvedConfigId) return failureResult("falha ao resolver agente alvo");

  // PR-5 (mai/2026): valida que agente alvo tem flow materializado.
  // Sem isso, proxima msg do lead cai em flow_executor_no_flow e a
  // conversa fica orfa silenciosamente.
  const { data: targetFlow, error: flowError } = await db
    .from("agent_flows")
    .select("id")
    .eq("organization_id", context.organization_id)
    .eq("agent_config_id", resolvedConfigId)
    .maybeSingle();

  if (flowError) return failureResult(flowError.message);
  if (!targetFlow) {
    return failureResult("target agent has no flow configured", {
      target_config_id: resolvedConfigId,
      hint: "configure o canvas do agente alvo antes de transferir",
    });
  }

  if (context.dry_run) {
    return successResult(
      {
        old_config_id: currentRow.config_id,
        new_config_id: resolvedConfigId,
        old_node_id: currentRow.current_node_id ?? null,
        new_node_id: null, // proxima execucao comeca pelo entry
        reason,
      },
      ["would transfer conversation to another native agent (flow model)"],
    );
  }

  const currentEpoch = currentRow.ai_control_epoch ?? 0;
  const { error: updateError } = await db
    .from("agent_conversations")
    .update({
      config_id: resolvedConfigId,
      current_node_id: null, // proxima msg do lead entra pelo entry do flow novo
      ai_control_epoch: currentEpoch + 1, // invalida runs em flight do agente antigo
      updated_at: nowIso(),
      last_interaction_at: nowIso(),
    })
    .eq("id", context.agent_conversation_id)
    .eq("organization_id", context.organization_id);

  if (updateError) return failureResult(updateError.message);

  return successResult(
    {
      old_config_id: currentRow.config_id,
      new_config_id: resolvedConfigId,
      old_node_id: currentRow.current_node_id ?? null,
      new_node_id: null,
      reason,
      preserved_history_summary: true,
      preserved_variables: true,
      epoch_bumped: true,
    },
    ["transferred conversation to another native agent (flow model)"],
  );
};
