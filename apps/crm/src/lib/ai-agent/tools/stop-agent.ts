import type { NativeHandler } from "@persia/shared/ai-agent";
import { asAgentDb, nowIso } from "../db";

export const stopAgentHandler: NativeHandler = async (context, input) => {
  const reason = typeof input.reason === "string" && input.reason.trim()
    ? input.reason.trim().slice(0, 500)
    : "agent_requested_handoff";

  if (context.dry_run) {
    return {
      success: true,
      output: {
        human_handoff_at: "[dry_run]",
        reason,
      },
      side_effects: ["would pause native agent for this conversation"],
    };
  }

  const db = asAgentDb((context as unknown as { db?: unknown }).db as never);
  if (!db?.from) {
    return {
      success: false,
      output: {},
      error: "database context missing",
    };
  }

  const { error } = await db
    .from("agent_conversations")
    .update({
      human_handoff_at: nowIso(),
      human_handoff_reason: reason,
      updated_at: nowIso(),
    })
    .eq("id", context.agent_conversation_id)
    .eq("organization_id", context.organization_id);

  if (error) {
    return { success: false, output: {}, error: error.message };
  }

  return {
    success: true,
    output: {
      human_handoff_at: "now",
      reason,
    },
    side_effects: ["paused native agent for this conversation"],
  };
};
