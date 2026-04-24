// AI Agent — PR5.7 context summarization contract.
//
// Problem: without summarization, a 15-turn conversation feeds every Claude
// call with the full raw message history. Tokens accumulate linearly,
// cost_ceiling_tokens fires early, latency grows. The column
// `agent_conversations.history_summary` existed since migration 017 but
// the executor never wrote to it.
//
// Solution (inspired by the gerarNovoContexto pattern in the 03 Console
// n8n workflow): consolidate via LLM on a hybrid trigger — every N turns OR
// after N accumulated tokens, whichever comes first — producing a prose
// summary covering profile, diagnosis, funnel status, conversational state,
// and narrative history. Future runs inject `history_summary + last K
// messages` instead of the full history.
//
// See CODEX_SYNC.md PR5.7 section for the executor flow and prompt
// template.

// ============================================================================
// Thresholds — hybrid trigger (whichever fires first)
// ============================================================================

export const CONTEXT_SUMMARY_TURN_THRESHOLD_DEFAULT = 10;
export const CONTEXT_SUMMARY_TURN_THRESHOLD_MIN = 3;
export const CONTEXT_SUMMARY_TURN_THRESHOLD_MAX = 50;

export const CONTEXT_SUMMARY_TOKEN_THRESHOLD_DEFAULT = 20_000;
export const CONTEXT_SUMMARY_TOKEN_THRESHOLD_MIN = 5_000;
export const CONTEXT_SUMMARY_TOKEN_THRESHOLD_MAX = 100_000;

// How many recent messages the executor injects alongside `history_summary`.
// Claude sees: [history_summary] + [last K messages] + [current inbound].
export const CONTEXT_SUMMARY_RECENT_MESSAGES_DEFAULT = 6;
export const CONTEXT_SUMMARY_RECENT_MESSAGES_MIN = 2;
export const CONTEXT_SUMMARY_RECENT_MESSAGES_MAX = 20;

// ============================================================================
// Per-agent configuration (mapped to flat columns on agent_configs)
// ============================================================================

export interface ContextSummarizationConfig {
  turn_threshold: number;       // trigger after N runs since last summary
  token_threshold: number;      // trigger after N accumulated tokens since last summary
  recent_messages_count: number; // how many recent messages to keep alongside summary
}

export const DEFAULT_CONTEXT_SUMMARIZATION: ContextSummarizationConfig = {
  turn_threshold: CONTEXT_SUMMARY_TURN_THRESHOLD_DEFAULT,
  token_threshold: CONTEXT_SUMMARY_TOKEN_THRESHOLD_DEFAULT,
  recent_messages_count: CONTEXT_SUMMARY_RECENT_MESSAGES_DEFAULT,
};

export function clampTurnThreshold(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return CONTEXT_SUMMARY_TURN_THRESHOLD_DEFAULT;
  return Math.max(
    CONTEXT_SUMMARY_TURN_THRESHOLD_MIN,
    Math.min(CONTEXT_SUMMARY_TURN_THRESHOLD_MAX, Math.round(value)),
  );
}

export function clampTokenThreshold(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return CONTEXT_SUMMARY_TOKEN_THRESHOLD_DEFAULT;
  return Math.max(
    CONTEXT_SUMMARY_TOKEN_THRESHOLD_MIN,
    Math.min(CONTEXT_SUMMARY_TOKEN_THRESHOLD_MAX, Math.round(value)),
  );
}

export function clampRecentMessagesCount(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return CONTEXT_SUMMARY_RECENT_MESSAGES_DEFAULT;
  return Math.max(
    CONTEXT_SUMMARY_RECENT_MESSAGES_MIN,
    Math.min(CONTEXT_SUMMARY_RECENT_MESSAGES_MAX, Math.round(value)),
  );
}

// ============================================================================
// Runtime state — mapped to columns on agent_conversations
// ============================================================================

// Counters the executor maintains on every successful run. Reset to 0 when a
// fresh summary is written. Both fields accumulate ACROSS runs since the
// last summary — they are NOT per-run.
export interface ConversationSummaryCounters {
  history_summary: string | null;
  history_summary_updated_at: string | null;
  history_summary_run_count: number;   // incremented by 1 each successful run since last summary
  history_summary_token_count: number; // incremented by tokens_input + tokens_output each run since last summary
}

export function shouldTriggerSummarization(
  counters: ConversationSummaryCounters,
  config: ContextSummarizationConfig,
): boolean {
  return (
    counters.history_summary_run_count >= config.turn_threshold ||
    counters.history_summary_token_count >= config.token_threshold
  );
}

// ============================================================================
// Audit — the summarization itself is a new agent_step type
// ============================================================================

// Input payload stored on the step for debugging. No raw LLM response body —
// the generated text lands in agent_conversations.history_summary.
export interface SummarizationStepInput {
  previous_summary_length: number; // chars
  message_count_since_last: number;
  tokens_since_last: number;
  trigger_reason: "turn_threshold" | "token_threshold";
}

export interface SummarizationStepOutput {
  success: boolean;
  new_summary_length: number;      // chars
  tokens_input: number;
  tokens_output: number;
  duration_ms: number;
  model: string;                   // model used for the summarization (usually agent.model)
  error?: string;
}
