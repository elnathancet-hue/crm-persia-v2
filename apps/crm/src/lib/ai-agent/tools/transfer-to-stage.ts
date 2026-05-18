import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { failureResult, getHandlerDb, successResult, trimReason } from "./shared";

// PR-AI-AGENT-TOOLS-NAMES (mai/2026): aceita `target_stage_name` (nome
// amigavel da etapa, vindo do catalogo no system prompt) OU `stage_id`
// (UUID — retrocompat). Pelo menos um obrigatorio.
const transferToStageSchema = z.object({
  target_stage_name: z.string().trim().min(1).max(200).optional(),
  stage_id: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const transferToStageHandler: NativeHandler = async (context, input) => {
  const parsed = transferToStageSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  if (!parsed.data.target_stage_name && !parsed.data.stage_id) {
    return failureResult(
      "informe target_stage_name (recomendado) ou stage_id",
    );
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const reason = trimReason(parsed.data.reason, "agent_requested_stage_transfer");
  const { data: agentConversation, error: conversationError } = await db
    .from("agent_conversations")
    .select("config_id, current_stage_id")
    .eq("id", context.agent_conversation_id)
    .eq("organization_id", context.organization_id)
    .maybeSingle();

  if (conversationError) return failureResult(conversationError.message);
  if (!agentConversation) return failureResult("agent conversation not found");

  // Resolve a stage de destino — UUID direto OU nome (case-insensitive,
  // restrito ao mesmo agente da conversa atual).
  let resolvedStageId: string | null = null;
  if (parsed.data.stage_id) {
    const { data: stage, error: stageError } = await db
      .from("agent_stages")
      .select("id, config_id")
      .eq("id", parsed.data.stage_id)
      .eq("organization_id", context.organization_id)
      .maybeSingle();
    if (stageError) return failureResult(stageError.message);
    if (!stage) return failureResult("target stage not found");
    const stageRow = stage as { id: string; config_id: string };
    if (stageRow.config_id !== agentConversation.config_id) {
      return failureResult("target stage must belong to the same agent config");
    }
    resolvedStageId = stageRow.id;
  } else if (parsed.data.target_stage_name) {
    const { data: stage, error: stageError } = await db
      .from("agent_stages")
      .select("id")
      .eq("organization_id", context.organization_id)
      .eq("config_id", agentConversation.config_id)
      .ilike("situation", parsed.data.target_stage_name)
      .limit(1)
      .maybeSingle();
    if (stageError) return failureResult(stageError.message);
    if (!stage) {
      return failureResult("etapa do agente nao encontrada", {
        requested: parsed.data.target_stage_name,
        hint: "use o nome EXATO da etapa do catalogo no contexto",
      });
    }
    resolvedStageId = (stage as { id: string }).id;
  }

  if (!resolvedStageId) return failureResult("falha ao resolver etapa de destino");

  if (context.dry_run) {
    return successResult(
      {
        old_stage_id: agentConversation.current_stage_id ?? null,
        new_stage_id: resolvedStageId,
        reason,
      },
      ["would move conversation to another stage in the same agent"],
    );
  }

  const { error: updateError } = await db
    .from("agent_conversations")
    .update({
      current_stage_id: resolvedStageId,
      updated_at: nowIso(),
      last_interaction_at: nowIso(),
    })
    .eq("id", context.agent_conversation_id)
    .eq("organization_id", context.organization_id);

  if (updateError) return failureResult(updateError.message);

  return successResult(
    {
      old_stage_id: agentConversation.current_stage_id ?? null,
      new_stage_id: resolvedStageId,
      reason,
    },
    ["moved conversation to another stage"],
  );
};

