// AI Agent — PR5.5 message debouncing contract.
//
// Why: without debounce, a lead sending "oi" + "tudo bem?" in 2s produces two
// parallel runs, two fragmented replies, and a race on current_stage_id.
// Debounce aggregates inbound messages per conversation into a single run.
//
// Architecture (see CODEX_SYNC.md PR5.5 section for the full spec):
//   webhook -> enqueueDebounced -> pending_messages INSERT + set next_flush_at
//   pg_cron (every ~2s) -> pg_net.http_post -> /api/ai-agent/debounce-flush
//   flush endpoint -> executor on the concatenated batch -> mark pending_messages flushed
//
// Storage:
//   - agent_conversations.next_flush_at TIMESTAMPTZ  (null when no pending)
//   - agent_configs.debounce_window_ms INTEGER       (default 10000)
//   - pending_messages(id, organization_id, agent_conversation_id, ...)

export const DEBOUNCE_WINDOW_MS_DEFAULT = 10_000;
export const DEBOUNCE_WINDOW_MS_MIN = 3_000;
export const DEBOUNCE_WINDOW_MS_MAX = 30_000;

// Shape of a pending_messages row (PR5.5 migration 019).
export interface PendingMessage {
  id: string;
  organization_id: string;
  agent_conversation_id: string;
  // Raw inbound body. Media messages store a short placeholder text like
  // "[audio received]" plus media_ref so the executor can decide whether to
  // transcribe / describe. The executor still reads messages.id via
  // inbound_message_id if the caller needs the full content.
  text: string;
  message_type:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "location"
    | "other";
  media_ref: string | null;             // chat-media ref if applicable
  inbound_message_id: string | null;    // references public.messages(id)
  received_at: string;                  // ISO-8601
  flushed_at: string | null;            // null while waiting to be consumed
  created_at: string;
}

// What the debounce-flush endpoint consumes for one conversation.
export interface DebounceFlushBatch {
  agent_conversation_id: string;
  organization_id: string;
  pending_message_ids: string[];        // in received_at ASC order
  concatenated_text: string;            // separated by "\n" in received_at order
  latest_inbound_message_id: string | null;
  earliest_received_at: string;         // for observability
  latest_received_at: string;
}

export interface DebounceFlushResult {
  flushed_conversations: number;
  runs_created: number;
  errors: number;
  // Per-conversation details for the observability dashboard; capped.
  details?: Array<{
    agent_conversation_id: string;
    pending_message_count: number;
    run_id: string | null;
    status: "succeeded" | "failed" | "fallback" | "skipped";
    error?: string;
  }>;
}

// Clamp helper consumed by UI + server actions so the written window always
// sits inside the supported range, even if an older client forgets to check.
export function clampDebounceWindowMs(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEBOUNCE_WINDOW_MS_DEFAULT;
  return Math.max(DEBOUNCE_WINDOW_MS_MIN, Math.min(DEBOUNCE_WINDOW_MS_MAX, Math.round(value)));
}
