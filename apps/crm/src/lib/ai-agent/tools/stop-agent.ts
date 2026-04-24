import type { NativeHandler } from "@persia/shared/ai-agent";
import { HANDOFF_DEFAULT_TEMPLATE } from "@persia/shared/ai-agent";
import {
  sendHandoffNotification,
  type SendHandoffNotificationResult,
} from "../handoff-notification";
import { nowIso } from "../db";
import {
  failureResult,
  getHandlerAnthropicClient,
  getHandlerConfig,
  getHandlerConversation,
  getHandlerDb,
  getHandlerProvider,
  getHandlerStepOrderIndex,
  insertLeadActivity,
  successResult,
  trimReason,
} from "./shared";

export const stopAgentHandler: NativeHandler = async (context, input) => {
  const reason = trimReason(input.reason, "agent_requested_handoff");
  const config = getHandlerConfig(context);
  const conversation = getHandlerConversation(context);

  if (context.dry_run) {
    const previewEnabled = Boolean(
      config?.handoff_notification_enabled &&
      config?.handoff_notification_target_type &&
      config?.handoff_notification_target_address,
    );
    return successResult(
      {
        human_handoff_at: "[dry_run]",
        reason,
        handoff_notification: {
          attempted: false,
          sent: false,
          simulated: previewEnabled,
          target_type: config?.handoff_notification_target_type ?? null,
          template_length: (config?.handoff_notification_template?.trim() || HANDOFF_DEFAULT_TEMPLATE).length,
        },
      },
      [
        "would pause native agent for this conversation",
        ...(previewEnabled ? ["would attempt handoff notification"] : []),
      ],
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

  let handoffNotification: SendHandoffNotificationResult = {
    attempted: false,
    sent: false,
    audit: {},
  };

  if (config && conversation) {
    handoffNotification = await sendHandoffNotification({
      db,
      orgId: context.organization_id,
      runId: context.run_id,
      stepOrderIndex: getHandlerStepOrderIndex(context) ?? 0,
      config,
      conversation,
      leadId: context.lead_id,
      handoffReason: reason,
      provider: getHandlerProvider(context),
      anthropicClient: getHandlerAnthropicClient(context),
    });
  }

  return successResult(
    {
      human_handoff_at: "now",
      reason,
      handoff_notification: {
        attempted: handoffNotification.attempted,
        sent: handoffNotification.sent,
        error: handoffNotification.error,
        audit: handoffNotification.audit,
      },
    },
    [
      "paused native agent for this conversation",
      "added internal lead activity note",
      ...(handoffNotification.attempted
        ? [handoffNotification.sent ? "sent handoff notification" : "handoff notification failed"]
        : []),
    ],
  );
};
