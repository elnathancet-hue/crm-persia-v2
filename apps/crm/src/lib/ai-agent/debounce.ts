import "server-only";

import type {
  DebounceFlushBatch,
  DebounceFlushResult,
  PendingMessage,
} from "@persia/shared/ai-agent";
import { errorMessage, logError } from "@/lib/observability";
import { type AgentDb } from "./db";

export interface EnqueueDebouncedParams {
  db: AgentDb;
  orgId: string;
  agentConversationId: string;
  debounceWindowMs: number;
  inboundMessageId: string | null;
  text: string;
  messageType: PendingMessage["message_type"];
  mediaRef: string | null;
  receivedAt: Date;
}

export interface FlushReadyConversationsParams {
  db: AgentDb;
  now?: Date;
  maxConversations?: number;
  requestId?: string;
}

interface AgentConversationQueueRow {
  id: string;
  organization_id: string;
  next_flush_at: string | null;
}

interface DebounceRpcClient {
  rpc(
    fn:
      | "enqueue_pending_message"
      | "claim_agent_conversation_flush"
      | "complete_agent_conversation_flush"
      | "release_agent_conversation_flush",
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export async function enqueueDebounced(params: EnqueueDebouncedParams): Promise<void> {
  const { error } = await (params.db as unknown as DebounceRpcClient).rpc(
    "enqueue_pending_message",
    {
      p_organization_id: params.orgId,
      p_agent_conversation_id: params.agentConversationId,
      p_debounce_window_ms: params.debounceWindowMs,
      p_inbound_message_id: params.inboundMessageId,
      p_text: params.text,
      p_message_type: params.messageType,
      p_media_ref: params.mediaRef,
      p_received_at: params.receivedAt.toISOString(),
    },
  );

  if (error) throw new Error(error.message);
}

export async function flushReadyConversations(
  params: FlushReadyConversationsParams,
): Promise<DebounceFlushResult> {
  const now = params.now ?? new Date();
  const maxConversations = Math.max(1, Math.min(params.maxConversations ?? 50, 50));
  const details: NonNullable<DebounceFlushResult["details"]> = [];
  let flushedConversations = 0;
  let runsCreated = 0;
  let errors = 0;

  const { data: candidateRows, error: candidateError } = await params.db
    .from("agent_conversations")
    .select("id, organization_id, next_flush_at")
    .lte("next_flush_at", now.toISOString())
    .order("next_flush_at", { ascending: true })
    .limit(maxConversations);

  if (candidateError) throw new Error(candidateError.message);

  const executeDebouncedBatch = (await import("./executor")).executeDebouncedBatch;

  for (const row of (candidateRows ?? []) as AgentConversationQueueRow[]) {
    const claimed = await claimConversation(params.db, row.organization_id, row.id, now);
    if (!claimed) {
      details.push({
        agent_conversation_id: row.id,
        pending_message_count: 0,
        run_id: null,
        status: "skipped",
      });
      continue;
    }

    try {
      const pendingMessages = await loadPendingMessages(params.db, row.organization_id, row.id);
      if (pendingMessages.length === 0) {
        await releaseConversation(params.db, row.organization_id, row.id, now);
        details.push({
          agent_conversation_id: row.id,
          pending_message_count: 0,
          run_id: null,
          status: "skipped",
        });
        continue;
      }

      const batch = buildBatch(row.organization_id, row.id, pendingMessages);
      const result = await executeDebouncedBatch({
        db: params.db,
        orgId: row.organization_id,
        batch,
        requestId: params.requestId,
      });

      await completeConversation(
        params.db,
        row.organization_id,
        row.id,
        batch.pending_message_ids,
        now,
      );

      flushedConversations += 1;
      if (result.runId) runsCreated += 1;
      if (result.status === "failed") errors += 1;
      details.push({
        agent_conversation_id: row.id,
        pending_message_count: batch.pending_message_ids.length,
        run_id: result.runId,
        status: result.status,
      });
    } catch (error) {
      errors += 1;
      await releaseConversation(params.db, row.organization_id, row.id, now).catch(() => {});
      logError("ai_agent_debounce_flush_failed", {
        organization_id: row.organization_id,
        request_id: params.requestId ?? null,
        agent_conversation_id: row.id,
        error: errorMessage(error),
      });
      details.push({
        agent_conversation_id: row.id,
        pending_message_count: 0,
        run_id: null,
        status: "failed",
        error: errorMessage(error),
      });
    }
  }

  return {
    flushed_conversations: flushedConversations,
    runs_created: runsCreated,
    errors,
    details,
  };
}

async function claimConversation(
  db: AgentDb,
  orgId: string,
  agentConversationId: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await (db as unknown as DebounceRpcClient).rpc(
    "claim_agent_conversation_flush",
    {
      p_organization_id: orgId,
      p_agent_conversation_id: agentConversationId,
      p_now: now.toISOString(),
      p_lease_seconds: 120,
    },
  );

  if (error) throw new Error(error.message);
  return data === true;
}

async function completeConversation(
  db: AgentDb,
  orgId: string,
  agentConversationId: string,
  pendingMessageIds: string[],
  now: Date,
): Promise<void> {
  const { error } = await (db as unknown as DebounceRpcClient).rpc(
    "complete_agent_conversation_flush",
    {
      p_organization_id: orgId,
      p_agent_conversation_id: agentConversationId,
      p_pending_message_ids: pendingMessageIds,
      p_completed_at: now.toISOString(),
    },
  );

  if (error) throw new Error(error.message);
}

async function releaseConversation(
  db: AgentDb,
  orgId: string,
  agentConversationId: string,
  now: Date,
): Promise<void> {
  const { error } = await (db as unknown as DebounceRpcClient).rpc(
    "release_agent_conversation_flush",
    {
      p_organization_id: orgId,
      p_agent_conversation_id: agentConversationId,
      p_released_at: now.toISOString(),
    },
  );

  if (error) throw new Error(error.message);
}

async function loadPendingMessages(
  db: AgentDb,
  orgId: string,
  agentConversationId: string,
): Promise<PendingMessage[]> {
  const { data, error } = await db
    .from("pending_messages")
    .select("*")
    .eq("organization_id", orgId)
    .eq("agent_conversation_id", agentConversationId)
    .is("flushed_at", null)
    .order("received_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as PendingMessage[];
}

function buildBatch(
  orgId: string,
  agentConversationId: string,
  pendingMessages: PendingMessage[],
): DebounceFlushBatch {
  const latestMessage = pendingMessages[pendingMessages.length - 1];

  return {
    agent_conversation_id: agentConversationId,
    organization_id: orgId,
    pending_message_ids: pendingMessages.map((message) => message.id),
    concatenated_text: pendingMessages
      .map((message) => message.text?.trim())
      .filter(Boolean)
      .join("\n"),
    latest_inbound_message_id: latestMessage?.inbound_message_id ?? null,
    earliest_received_at: pendingMessages[0]?.received_at ?? new Date(0).toISOString(),
    latest_received_at: latestMessage?.received_at ?? new Date(0).toISOString(),
  };
}
