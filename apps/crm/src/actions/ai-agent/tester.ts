"use server";

import type {
  AgentStepType,
  NativeHandlerName,
  TesterRequest,
  TesterResponse,
  TesterStepSummary,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "@/lib/ai-agent/db";
import { executeTesterAgent } from "@/lib/ai-agent/executor";
import { requireAgentRole } from "./utils";

interface StepRow {
  step_type: AgentStepType;
  tool_id: string | null;
  native_handler: NativeHandlerName | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  duration_ms: number;
}

export async function testAgent(req: TesterRequest): Promise<TesterResponse> {
  const { db, orgId } = await requireAgentRole("admin");
  return testAgentForOrg(orgId, req, db);
}

export async function testAgentForOrg(
  orgId: string,
  req: TesterRequest,
  dbOverride?: AgentDb,
): Promise<TesterResponse> {
  const db = dbOverride ?? (await requireAgentRole("admin")).db;
  if (!req.config_id) throw new Error("config_id e obrigatorio");
  if (!req.message?.trim()) throw new Error("Mensagem de teste e obrigatoria");

  const result = await executeTesterAgent({
    db,
    orgId,
    configId: req.config_id,
    stageId: req.stage_id,
    message: req.message.trim(),
    state: req.conversation_state,
  });

  const { data: stepsData, error: stepsError } = await db
    .from("agent_steps")
    .select("step_type, tool_id, native_handler, input, output, duration_ms")
    .eq("organization_id", orgId)
    .eq("run_id", result.runId)
    .order("order_index", { ascending: true });

  if (stepsError) throw new Error(stepsError.message);

  const toolIds = Array.from(
    new Set((stepsData ?? []).map((step: StepRow) => step.tool_id).filter(Boolean)),
  ) as string[];
  const toolNames = await loadToolNames(db, orgId, toolIds);

  const steps: TesterStepSummary[] = ((stepsData ?? []) as StepRow[]).map((step) => ({
    step_type: step.step_type,
    tool_name: step.tool_id ? toolNames.get(step.tool_id) : undefined,
    native_handler: step.native_handler ?? undefined,
    input: step.input ?? undefined,
    output: step.output ?? undefined,
    duration_ms: step.duration_ms,
  }));

  return {
    run_id: result.runId,
    status: result.status,
    assistant_reply: result.assistantReply,
    steps,
    tokens_used: result.tokensInput + result.tokensOutput,
    cost_usd_cents: result.costUsdCents,
    next_stage_id: result.nextStageId,
    error: result.error,
  };
}

async function loadToolNames(
  db: AgentDb,
  orgId: string,
  toolIds: string[],
): Promise<Map<string, string>> {
  if (toolIds.length === 0) return new Map();
  const { data } = await db
    .from("agent_tools")
    .select("id, name")
    .eq("organization_id", orgId)
    .in("id", toolIds);
  return new Map((data ?? []).map((tool: { id: string; name: string }) => [tool.id, tool.name]));
}
