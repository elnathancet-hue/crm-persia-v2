import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { failureResult, getHandlerDb, successResult, trimReason } from "./shared";

const transferToAgentSchema = z.object({
  agent_config_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const transferToAgentHandler: NativeHandler = async (context, input) => {
  const parsed = transferToAgentSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
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

  const { data: targetConfig, error: configError } = await db
    .from("agent_configs")
    .select("id, status")
    .eq("id", parsed.data.agent_config_id)
    .eq("organization_id", context.organization_id)
    .maybeSingle();

  if (configError) return failureResult(configError.message);
  if (!targetConfig) return failureResult("target agent config not found");
  if (targetConfig.status !== "active") {
    return failureResult("target agent config must be active");
  }

  const { data: firstStage, error: stageError } = await db
    .from("agent_stages")
    .select("id")
    .eq("organization_id", context.organization_id)
    .eq("config_id", parsed.data.agent_config_id)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (stageError) return failureResult(stageError.message);
  if (!firstStage?.id) return failureResult("target agent config has no stages");

  if (context.dry_run) {
    return successResult(
      {
        old_config_id: currentConversation.config_id,
        new_config_id: parsed.data.agent_config_id,
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
      config_id: parsed.data.agent_config_id,
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
      new_config_id: parsed.data.agent_config_id,
      old_stage_id: currentConversation.current_stage_id ?? null,
      new_stage_id: firstStage.id,
      reason,
      preserved_history_summary: true,
      preserved_variables: true,
    },
    ["transferred conversation to another native agent"],
  );
};

