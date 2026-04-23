import { DEFAULT_RATE_LIMITS, type RateLimitConfig } from "@persia/shared/ai-agent";
import { type AgentDb } from "./db";
import { GuardrailError } from "./guardrails";

export async function assertWithinRateLimits(params: {
  db: AgentDb;
  orgId: string;
  agentConversationId: string;
  config?: RateLimitConfig;
}): Promise<void> {
  const config = params.config ?? DEFAULT_RATE_LIMITS;
  const since = new Date(Date.now() - 60_000).toISOString();

  const { data: recentRuns, error: recentRunsError } = await params.db
    .from("agent_runs")
    .select("id")
    .eq("organization_id", params.orgId)
    .eq("agent_conversation_id", params.agentConversationId)
    .gte("created_at", since);

  if (recentRunsError) throw new Error(recentRunsError.message);
  if ((recentRuns ?? []).length >= config.max_runs_per_minute_per_conversation) {
    throw new GuardrailError(
      "rate_limit_conversation",
      "AI agent conversation rate limit reached",
    );
  }

  const { data: runningRuns, error: runningRunsError } = await params.db
    .from("agent_runs")
    .select("id")
    .eq("organization_id", params.orgId)
    .eq("status", "running");

  if (runningRunsError) throw new Error(runningRunsError.message);
  if ((runningRuns ?? []).length >= config.max_concurrent_runs_per_org) {
    throw new GuardrailError(
      "rate_limit_org_concurrent",
      "AI agent organization concurrent run limit reached",
    );
  }
}
