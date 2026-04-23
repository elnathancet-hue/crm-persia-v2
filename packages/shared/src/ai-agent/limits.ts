// AI Agent — production guardrails: cost limits + rate limits + usage stats.
//
// The per-run `AgentGuardrails.cost_ceiling_tokens` (in types.ts) is still the
// executor's per-inbound cap. This module adds higher-order envelopes so that
// a single org cannot burn a month of budget in a few hours — even across
// many conversations.
//
// Enforcement lives in apps/crm/src/lib/ai-agent/cost-limits.ts and
// rate-limits.ts; the executor calls the checker before each LLM iteration
// and on tool result.

// ============================================================================
// Cost limits — multi-scope budgets per org, per agent, per run.
// ============================================================================

export type CostLimitScope =
  | "run"            // per single executor run (mirrors AgentGuardrails.cost_ceiling_tokens)
  | "agent_daily"    // per agent_config, sum of runs in a rolling 24h window
  | "org_daily"      // per organization, sum of all agent runs in a rolling 24h window
  | "org_monthly";   // per organization, calendar month (UTC)

export const COST_LIMIT_SCOPES: readonly CostLimitScope[] = [
  "run",
  "agent_daily",
  "org_daily",
  "org_monthly",
];

export interface AgentCostLimit {
  id: string;
  organization_id: string;
  scope: CostLimitScope;
  // Subject of the limit: agent_config_id when scope === 'agent_daily',
  // otherwise null (org-level or run-level). Run-level still stored at org
  // level so admin can set a fleet-wide default, but executor prefers the
  // per-config `AgentGuardrails` when present.
  subject_id: string | null;
  max_tokens: number | null;      // null disables the token guardrail for this scope
  max_usd_cents: number | null;   // null disables the USD guardrail
  created_at: string;
  updated_at: string;
}

export interface SetCostLimitInput {
  scope: CostLimitScope;
  subject_id?: string;         // required when scope === 'agent_daily'
  max_tokens?: number | null;  // null | undefined -> clear
  max_usd_cents?: number | null;
}

// ============================================================================
// Usage aggregation — read-only views over agent_runs + agent_steps.
// ============================================================================

export interface UsageStatsInput {
  organization_id?: string;   // always injected server-side; keeps the DTO explicit
  config_id?: string;
  range: "today" | "last_7_days" | "last_30_days" | "month_to_date";
}

// Daily bucket, used to draw sparklines and tables.
export interface UsagePoint {
  day: string;                // ISO date (YYYY-MM-DD, UTC)
  run_count: number;
  succeeded_count: number;
  failed_count: number;
  fallback_count: number;
  tokens_input: number;
  tokens_output: number;
  cost_usd_cents: number;
  avg_duration_ms: number;
}

export interface UsageStats {
  range: UsageStatsInput["range"];
  organization_id: string;
  config_id: string | null;          // null = whole org
  points: UsagePoint[];              // ordered oldest → newest
  totals: UsagePointTotals;
  limits: ActiveCostLimits;          // resolved limits + current consumption
}

export interface UsagePointTotals {
  run_count: number;
  succeeded_count: number;
  failed_count: number;
  fallback_count: number;
  tokens_input: number;
  tokens_output: number;
  cost_usd_cents: number;
  avg_duration_ms: number;
  // Derived
  success_rate: number;              // succeeded_count / run_count, 0..1
  fallback_rate: number;              // fallback_count / run_count, 0..1
}

// Snapshot of the relevant limits + "where are we right now" consumption,
// so the UI can render progress bars without a second round trip.
export interface ActiveCostLimits {
  org_daily: CostLimitSnapshot | null;
  org_monthly: CostLimitSnapshot | null;
  agent_daily: CostLimitSnapshot | null;   // filled only when config_id is set
}

export interface CostLimitSnapshot {
  scope: CostLimitScope;
  subject_id: string | null;
  max_tokens: number | null;
  max_usd_cents: number | null;
  used_tokens: number;
  used_usd_cents: number;
  // Percentage of the more-restrictive gauge, 0..1. null if no gauge set.
  utilization: number | null;
}

// ============================================================================
// Rate limits — lightweight anti-spam for the webhook path.
// ============================================================================

export interface RateLimitConfig {
  // Max runs per rolling window per agent_conversation_id. Default 6 / 60s.
  max_runs_per_minute_per_conversation: number;
  // Max concurrent `status='running'` runs per org (prevents parallel loops).
  max_concurrent_runs_per_org: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  max_runs_per_minute_per_conversation: 6,
  max_concurrent_runs_per_org: 20,
};

// ============================================================================
// Guardrail trip — what the executor records in agent_steps when a limit fires.
// ============================================================================

export type GuardrailTripReason =
  | "run_cost_tokens"
  | "run_cost_timeout"
  | "run_iterations"
  | "agent_daily_tokens"
  | "agent_daily_usd"
  | "org_daily_tokens"
  | "org_daily_usd"
  | "org_monthly_tokens"
  | "org_monthly_usd"
  | "rate_limit_conversation"
  | "rate_limit_org_concurrent";
