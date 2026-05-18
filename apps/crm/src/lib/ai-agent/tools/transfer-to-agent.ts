import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { failureResult, getHandlerDb, successResult, trimReason } from "./shared";

// PR-AI-AGENT-TOOLS-NAMES (mai/2026): aceita `target_agent_name` (nome
// amigavel do agente alvo, vindo do catalogo no system prompt) OU
// `agent_config_id` (UUID — retrocompat). Pelo menos um obrigatorio.
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
    .select("config_id, current_stage_id, history_summary, variables")
    .eq("id", context.agent_conversation_id)
    .eq("organization_id", context.organization_id)
    .maybeSingle();

  if (conversationError) return failureResult(conversationError.message);
  if (!currentConversation) return failureResult("agent conversation not found");

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
      .neq("id", currentConversation.config_id)
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

  const { data: firstStage, error: stageError } = await db
    .from("agent_stages")
    .select("id")
    .eq("organization_id", context.organization_id)
    .eq("config_id", resolvedConfigId)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (stageError) return failureResult(stageError.message);
  if (!firstStage?.id) return failureResult("target agent config has no stages");

  if (context.dry_run) {
    return successResult(
      {
        old_config_id: currentConversation.config_id,
        new_config_id: resolvedConfigId,
        old_stage_id: currentConversation.current_stage_id ?? null,
        new_stage_id: firstStage.id,
        reason,
      },
      ["would transfer conversation to another native agent"],
    );
  }

  const { error: updateError } = await db
    .from("agent_conversations")
    .update({
      config_id: resolvedConfigId,
      current_stage_id: firstStage.id,
      updated_at: nowIso(),
      last_interaction_at: nowIso(),
    })
    .eq("id", context.agent_conversation_id)
    .eq("organization_id", context.organization_id);

  if (updateError) return failureResult(updateError.message);

  return successResult(
    {
      old_config_id: currentConversation.config_id,
      new_config_id: resolvedConfigId,
      old_stage_id: currentConversation.current_stage_id ?? null,
      new_stage_id: firstStage.id,
      reason,
      preserved_history_summary: true,
      preserved_variables: true,
    },
    ["transferred conversation to another native agent"],
  );
};

