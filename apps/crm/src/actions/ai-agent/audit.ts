"use server";

import type {
  AgentRun,
  AgentRunWithSteps,
  AgentStep,
  ListRunsInput,
} from "@persia/shared/ai-agent";
import { requireAgentRole } from "./utils";

export async function listRuns(input: ListRunsInput = {}): Promise<AgentRunWithSteps[]> {
  const { db, orgId } = await requireAgentRole("admin");
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const conversationIds = await resolveConversationIds(db, orgId, input);

  if (conversationIds && conversationIds.length === 0) return [];

  let query = db
    .from("agent_runs")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (conversationIds) {
    query = query.in("agent_conversation_id", conversationIds);
  }
  if (input.since) {
    query = query.gte("created_at", input.since);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const runs = (data ?? []) as AgentRun[];
  return attachSteps(db, orgId, runs);
}

export async function getRun(runId: string): Promise<AgentRunWithSteps | null> {
  const { db, orgId } = await requireAgentRole("admin");
  const { data, error } = await db
    .from("agent_runs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", runId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const [runWithSteps] = await attachSteps(db, orgId, [data as AgentRun]);
  return runWithSteps ?? null;
}

async function resolveConversationIds(
  db: Awaited<ReturnType<typeof requireAgentRole>>["db"],
  orgId: string,
  input: ListRunsInput,
): Promise<string[] | null> {
  if (!input.agent_conversation_id && !input.config_id && !input.lead_id) {
    return null;
  }

  let query = db
    .from("agent_conversations")
    .select("id")
    .eq("organization_id", orgId);

  if (input.agent_conversation_id) {
    query = query.eq("id", input.agent_conversation_id);
  }
  if (input.config_id) {
    query = query.eq("config_id", input.config_id);
  }
  if (input.lead_id) {
    query = query.eq("lead_id", input.lead_id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { id: string }) => row.id);
}

async function attachSteps(
  db: Awaited<ReturnType<typeof requireAgentRole>>["db"],
  orgId: string,
  runs: AgentRun[],
): Promise<AgentRunWithSteps[]> {
  if (runs.length === 0) return [];

  const runIds = runs.map((run) => run.id);
  const { data: stepRows, error: stepsError } = await db
    .from("agent_steps")
    .select("*")
    .eq("organization_id", orgId)
    .in("run_id", runIds)
    .order("order_index", { ascending: true });

  if (stepsError) throw new Error(stepsError.message);

  const stepsByRun = new Map<string, AgentStep[]>();
  for (const step of (stepRows ?? []) as AgentStep[]) {
    const existing = stepsByRun.get(step.run_id) ?? [];
    existing.push(step);
    stepsByRun.set(step.run_id, existing);
  }

  return runs.map((run) => ({
    ...run,
    steps: stepsByRun.get(run.id) ?? [],
  }));
}

