import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { failureResult, getHandlerDb, successResult, trimReason } from "./shared";

const transferToStageSchema = z.object({
  stage_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const transferToStageHandler: NativeHandler = async (context, input) => {
  const parsed = transferToStageSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
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

  const { data: stage, error: stageError } = await db
    .from("agent_stages")
    .select("id, config_id")
    .eq("id", parsed.data.stage_id)
    .eq("organization_id", context.organization_id)
    .maybeSingle();

  if (stageError) return failureResult(stageError.message);
  if (!stage) return failureResult("target stage not found");
  if (stage.config_id !== agentConversation.config_id) {
    return failureResult("target stage must belong to the same agent config");
  }

  if (context.dry_run) {
    return successResult(
      {
        old_stage_id: agentConversation.current_stage_id ?? null,
        new_stage_id: parsed.data.stage_id,
        reason,
      },
      ["would move conversation to another stage in the same agent"],
    );
  }

  const { error: updateError } = await db
    .from("agent_conversations")
    .update({
      current_stage_id: parsed.data.stage_id,
      updated_at: nowIso(),
      last_interaction_at: nowIso(),
    })
    .eq("id", context.agent_conversation_id)
    .eq("organization_id", context.organization_id);

  if (updateError) return failureResult(updateError.message);

  return successResult(
    {
      old_stage_id: agentConversation.current_stage_id ?? null,
      new_stage_id: parsed.data.stage_id,
      reason,
    },
    ["moved conversation to another stage"],
  );
};

