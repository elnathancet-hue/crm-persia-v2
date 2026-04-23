import type { NativeHandler } from "@persia/shared/ai-agent";
import { nowIso } from "../db";
import { failureResult, getHandlerDb, insertLeadActivity, successResult, trimReason } from "./shared";

export const stopAgentHandler: NativeHandler = async (context, input) => {
  const reason = trimReason(input.reason, "agent_requested_handoff");

  if (context.dry_run) {
    return successResult(
      {
        human_handoff_at: "[dry_run]",
        reason,
      },
      ["would pause native agent for this conversation"],
    );
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

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
    return failureResult(error.message);
  }

  await insertLeadActivity({
    db,
    organizationId: context.organization_id,
    leadId: context.lead_id,
    type: "agent_handoff",
    description: `Nota interna do agente: atendimento pausado para humano. Motivo: ${reason}`,
    metadata: {
      conversation_id: context.crm_conversation_id,
      agent_conversation_id: context.agent_conversation_id,
      run_id: context.run_id,
    },
  });

  return successResult(
    {
      human_handoff_at: "now",
      reason,
    },
    ["paused native agent for this conversation", "added internal lead activity note"],
  );
};
