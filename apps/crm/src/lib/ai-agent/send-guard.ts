import type { AgentDb } from "./db";

export interface AiOutboundSendGuard {
  db: AgentDb;
  organizationId: string;
  conversationId: string;
  agentConversationId: string;
  expectedControlEpoch: number;
}

export type AiOutboundSendGuardResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Last-mile guard for outbound AI messages.
 *
 * This intentionally runs immediately before each real WhatsApp send. A flow
 * can start while the AI owns the conversation, then finish after a human
 * takes over. The epoch check prevents old runs from speaking after ownership
 * changed, even if the conversation later returns to the AI.
 */
export async function canAiSendNow(
  guard: AiOutboundSendGuard,
): Promise<AiOutboundSendGuardResult> {
  const [conversationRes, agentConversationRes] = await Promise.all([
    guard.db
      .from("conversations")
      .select("assigned_to, status")
      .eq("organization_id", guard.organizationId)
      .eq("id", guard.conversationId)
      .maybeSingle(),
    guard.db
      .from("agent_conversations")
      .select("human_handoff_at, ai_control_epoch")
      .eq("organization_id", guard.organizationId)
      .eq("id", guard.agentConversationId)
      .maybeSingle(),
  ]);

  if (conversationRes.error) {
    return { ok: false, reason: "conversation_lookup_failed" };
  }
  if (!conversationRes.data) {
    return { ok: false, reason: "conversation_not_found" };
  }

  const conversation = conversationRes.data as {
    assigned_to?: string | null;
    status?: string | null;
  };
  if (conversation.assigned_to !== "ai") {
    return { ok: false, reason: "conversation_not_owned_by_ai" };
  }
  if (conversation.status !== "active") {
    return {
      ok: false,
      reason: `conversation_not_active:${conversation.status ?? "null"}`,
    };
  }

  if (agentConversationRes.error) {
    return { ok: false, reason: "agent_conversation_lookup_failed" };
  }
  if (!agentConversationRes.data) {
    return { ok: false, reason: "agent_conversation_not_found" };
  }

  const agentConversation = agentConversationRes.data as {
    human_handoff_at?: string | null;
    ai_control_epoch?: number | null;
  };
  if (agentConversation.human_handoff_at) {
    return { ok: false, reason: "human_handoff_active" };
  }

  const currentEpoch = agentConversation.ai_control_epoch ?? 0;
  if (currentEpoch !== guard.expectedControlEpoch) {
    return {
      ok: false,
      reason: `stale_ai_control_epoch:${currentEpoch}:${guard.expectedControlEpoch}`,
    };
  }

  return { ok: true };
}
