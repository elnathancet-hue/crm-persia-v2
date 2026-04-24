import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import {
  calculateCostUsdCents,
  toAnthropicTool,
  type AgentConfig,
  type AgentConversation,
  type AgentRunStatus,
  type AgentStage,
  type AgentStepType,
  type AgentTool,
  type NativeHandlerContext,
} from "@persia/shared/ai-agent";
import type { IncomingMessage, WhatsAppProvider } from "@/lib/whatsapp/provider";
import { errorMessage, logError, logInfo } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "./db";
import {
  createSyntheticAgentConversation,
  loadActiveAgentConfig,
  loadAgentConfigById,
  loadAllowedTools,
  loadStage,
  resolveAgentContext,
  updateConversationUsage,
} from "./context";
import { assertWithinCostLimits, type CostLimitCache } from "./cost-limits";
import {
  assertWithinDeadline,
  GuardrailError,
  normalizeGuardrails,
} from "./guardrails";
import { isNativeAgentEnabled } from "./feature-flag";
import { assertWithinRateLimits } from "./rate-limits";
import {
  getWebhookAllowlistDomains,
  invokeCustomWebhook,
} from "./webhook-caller";
import { isImplementedNativeHandler, nativeHandlers } from "./tools/registry";

type AnthropicMessage = {
  role: "user" | "assistant";
  content: unknown;
};

export type NativeAgentOutcome =
  | { handled: false; reason?: string }
  | { handled: true; response: Record<string, unknown> };

export interface TryNativeAgentParams {
  supabase: unknown;
  orgId: string;
  provider: WhatsAppProvider;
  msg: IncomingMessage;
  requestId?: string;
}

export interface ExecuteAgentParams {
  db: AgentDb;
  orgId: string;
  provider?: WhatsAppProvider;
  msg: IncomingMessage;
  requestId?: string;
  dryRun: boolean;
  config: AgentConfig;
  stage: AgentStage | null;
  agentConversation: AgentConversation;
  tools: AgentTool[];
  inboundMessageId: string | null;
  leadId: string;
  crmConversationId: string;
}

export interface ExecuteAgentResult {
  runId: string;
  status: AgentRunStatus;
  assistantReply: string;
  tokensInput: number;
  tokensOutput: number;
  costUsdCents: number;
  nextStageId: string | null;
  error?: string;
}

const HANDOFF_REPLY =
  "Vou chamar uma pessoa da equipe para continuar esse atendimento por aqui.";

export async function tryNativeAgent(params: TryNativeAgentParams): Promise<NativeAgentOutcome> {
  const db = asAgentDb(params.supabase as never);
  try {
    const enabled = await isNativeAgentEnabled(params.orgId, db);
    if (!enabled) return { handled: false, reason: "feature_flag_off" };

    const config = await loadActiveAgentConfig(db, params.orgId);
    if (!config) return { handled: false, reason: "no_active_config" };

    const resolved = await resolveAgentContext({
      db,
      orgId: params.orgId,
      msg: params.msg,
      config,
    });

    if ((resolved.agentConversation as AgentConversation & { human_handoff_at?: string | null }).human_handoff_at) {
      return {
        handled: true,
        response: { ok: true, skipped: "native_agent_handoff" },
      };
    }

    try {
      await assertWithinRateLimits({
        db,
        orgId: params.orgId,
        agentConversationId: resolved.agentConversation.id,
      });
    } catch (error) {
      if (error instanceof GuardrailError) {
        return {
          handled: true,
          response: {
            ok: true,
            skipped: "rate_limited",
            handledBy: "ai_native",
            leadId: resolved.crm.leadId,
            conversationId: resolved.crm.crmConversationId,
          },
        };
      }
      throw error;
    }

    const result = await executeAgent({
      db,
      orgId: params.orgId,
      provider: params.provider,
      msg: params.msg,
      requestId: params.requestId,
      dryRun: false,
      config: resolved.config,
      stage: resolved.stage,
      agentConversation: resolved.agentConversation,
      tools: resolved.tools,
      inboundMessageId: resolved.crm.inboundMessageId,
      leadId: resolved.crm.leadId,
      crmConversationId: resolved.crm.crmConversationId,
    });

    if (result.status === "failed") {
      return { handled: false, reason: result.error ?? "native_failed" };
    }

    return {
      handled: true,
      response: {
        ok: result.status === "succeeded" || result.status === "fallback",
        handledBy: "ai_native",
        leadId: resolved.crm.leadId,
        conversationId: resolved.crm.crmConversationId,
        runId: result.runId,
        status: result.status,
      },
    };
  } catch (error) {
    logError("native_agent_try_failed", {
      organization_id: params.orgId,
      request_id: params.requestId ?? null,
      error: errorMessage(error),
    });
    return { handled: false, reason: "exception" };
  }
}

export async function executeAgent(params: ExecuteAgentParams): Promise<ExecuteAgentResult> {
  const startedAt = Date.now();
  const guardrails = normalizeGuardrails(params.config.guardrails);
  const run = await createRun(params);
  let tokensInput = 0;
  let tokensOutput = 0;
  let orderIndex = 0;
  let assistantReply = "";
  const costLimitCache: CostLimitCache = {};
  const messages: AnthropicMessage[] = [
    {
      role: "user",
      content: params.msg.text || "[incoming media message]",
    },
  ];

  try {
    if (!params.stage) {
      throw new Error("agent has no stages");
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const tools = params.tools.map(toAnthropicTool);
    const system = buildSystemPrompt(params.config, params.stage);

    await updateRunStatus(params.db, run.id, params.orgId, "running");

    for (let iteration = 0; iteration < guardrails.max_iterations; iteration++) {
      assertWithinDeadline(startedAt, guardrails);
      await assertWithinCostLimits({
        db: params.db,
        orgId: params.orgId,
        configId: params.config.id,
        agentConversationId: params.agentConversation.id,
        tokensSoFarRun: tokensInput + tokensOutput,
        costSoFarRunUsdCents: calculateCostUsdCents(params.config.model, tokensInput, tokensOutput),
        guardrailsTokens: guardrails.cost_ceiling_tokens,
        cache: costLimitCache,
      });

      const response = await withTimeout(
        client.messages.create({
          model: params.config.model,
          max_tokens: 1024,
          system,
          tools: tools as never,
          messages: messages as never,
        } as never),
        Math.max(1, guardrails.timeout_seconds) * 1000,
      ) as any;
      const usage = readUsage(response);
      tokensInput += usage.input;
      tokensOutput += usage.output;
      await insertStep(params.db, {
        orgId: params.orgId,
        runId: run.id,
        orderIndex: orderIndex++,
        stepType: "llm",
        input: { iteration },
        output: {
          stop_reason: response.stop_reason ?? null,
          tokens_input: usage.input,
          tokens_output: usage.output,
        },
        durationMs: Date.now() - startedAt,
      });

      await assertWithinCostLimits({
        db: params.db,
        orgId: params.orgId,
        configId: params.config.id,
        agentConversationId: params.agentConversation.id,
        tokensSoFarRun: tokensInput + tokensOutput,
        costSoFarRunUsdCents: calculateCostUsdCents(params.config.model, tokensInput, tokensOutput),
        guardrailsTokens: guardrails.cost_ceiling_tokens,
        cache: costLimitCache,
      });

      const toolCalls = extractToolCalls(response);
      if (response.stop_reason !== "tool_use" || toolCalls.length === 0) {
        assistantReply = extractText(response) || HANDOFF_REPLY;
        if (!params.dryRun && params.provider) {
          await params.provider.sendText({ phone: params.msg.phone, message: assistantReply });
        }
        const final = await finishRun(params, {
          runId: run.id,
          status: "succeeded",
          startedAt,
          tokensInput,
          tokensOutput,
        });
        return { ...final, assistantReply, nextStageId: params.stage.id };
      }

      messages.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const call of toolCalls) {
        const tool = params.tools.find((candidate) => candidate.name === call.name) ?? null;
        const toolResult = await executeToolCall(params, {
          runId: run.id,
          orderIndex: orderIndex++,
          tool,
          toolUseId: call.id,
          input: call.input,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(toolResult.output),
          is_error: !toolResult.success,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    throw new GuardrailError("run_iterations", "AI agent max iterations reached");
  } catch (error) {
    if (error instanceof GuardrailError) {
      if (!params.dryRun && params.provider) {
        await params.provider.sendText({ phone: params.msg.phone, message: HANDOFF_REPLY });
      }
      await insertStep(params.db, {
        orgId: params.orgId,
        runId: run.id,
        orderIndex: orderIndex++,
        stepType: "guardrail",
        input: { reason: error.reason },
        output: { message: error.message },
        durationMs: Date.now() - startedAt,
      });
      const final = await finishRun(params, {
        runId: run.id,
        status: "fallback",
        startedAt,
        tokensInput,
        tokensOutput,
        errorMsg: error.message,
      });
      return {
        ...final,
        assistantReply: HANDOFF_REPLY,
        nextStageId: params.stage?.id ?? null,
        error: error.message,
      };
    }

    await finishRun(params, {
      runId: run.id,
      status: "failed",
      startedAt,
      tokensInput,
      tokensOutput,
      errorMsg: errorMessage(error),
    });
    logError("native_agent_execute_failed", {
      organization_id: params.orgId,
      request_id: params.requestId ?? null,
      run_id: run.id,
      error: errorMessage(error),
    });
    return {
      runId: run.id,
      status: "failed",
      assistantReply: "",
      tokensInput,
      tokensOutput,
      costUsdCents: calculateCostUsdCents(params.config.model, tokensInput, tokensOutput),
      nextStageId: params.stage?.id ?? null,
      error: errorMessage(error),
    };
  }
}

export async function executeTesterAgent(params: {
  db: AgentDb;
  orgId: string;
  configId: string;
  stageId?: string;
  message: string;
  state?: {
    current_stage_id: string | null;
    history_summary: string | null;
    variables: Record<string, unknown>;
  };
}): Promise<ExecuteAgentResult> {
  const config = await loadAgentConfigById(params.db, params.orgId, params.configId);
  if (!config) throw new Error("Agent config not found");
  const stage = params.stageId
    ? await loadStage(params.db, params.orgId, config.id, params.stageId)
    : await loadStage(params.db, params.orgId, config.id, params.state?.current_stage_id ?? null);
  const agentConversation = await createSyntheticAgentConversation({
    db: params.db,
    orgId: params.orgId,
    config,
    stageId: stage?.id ?? null,
    state: params.state,
  });
  const tools = stage ? await loadAllowedTools(params.db, params.orgId, config.id, stage.id) : [];
  return executeAgent({
    db: params.db,
    orgId: params.orgId,
    msg: {
      phone: "tester",
      pushName: "Tester",
      text: params.message,
      type: "text",
      messageId: `tester-${crypto.randomUUID()}`,
    } as IncomingMessage,
    dryRun: true,
    config,
    stage,
    agentConversation,
    tools,
    inboundMessageId: null,
    leadId: "tester",
    crmConversationId: "tester",
  });
}

async function executeToolCall(
  params: ExecuteAgentParams,
  call: {
    runId: string;
    orderIndex: number;
    tool: AgentTool | null;
    toolUseId: string;
    input: Record<string, unknown>;
  },
): Promise<{ success: boolean; output: Record<string, unknown> }> {
  const startedAt = Date.now();
  let success = false;
  let output: Record<string, unknown> = {};
  let stepOutput: Record<string, unknown> | null = null;
  let nativeHandler = call.tool?.native_handler ?? null;

  try {
    if (!call.tool) {
      output = { error: "tool not allowed in current stage" };
      return { success, output };
    }
    if (call.tool.execution_mode === "n8n_webhook") {
      if (!call.tool.webhook_url || !call.tool.webhook_secret) {
        output = { error: "webhook tool is not fully configured" };
        stepOutput = { success, ...output };
        return { success, output };
      }

      const allowlist = await loadWebhookAllowlist(params.db, params.orgId);
      const result = await invokeCustomWebhook({
        tool_id: call.tool.id,
        webhook_url: call.tool.webhook_url,
        webhook_secret: call.tool.webhook_secret,
        payload: call.input,
        context: {
          organization_id: params.orgId,
          lead_id: params.leadId,
          crm_conversation_id: params.crmConversationId,
          agent_conversation_id: params.agentConversation.id,
          run_id: call.runId,
          dry_run: params.dryRun,
        },
        allowlist,
      });

      success = result.success;
      output = result.output;
      stepOutput = { success, ...result.audit_output };
      return { success, output };
    }

    if (!isImplementedNativeHandler(call.tool.native_handler)) {
      output = { error: "handler not implemented in this release" };
      return { success, output };
    }

    nativeHandler = call.tool.native_handler;
    const handler = nativeHandlers[call.tool.native_handler]!;
    const context: NativeHandlerContext & { db: AgentDb } = {
      db: params.db,
      organization_id: params.orgId,
      lead_id: params.leadId,
      crm_conversation_id: params.crmConversationId,
      agent_conversation_id: params.agentConversation.id,
      run_id: call.runId,
      dry_run: params.dryRun,
    };
    const result = await handler(context, call.input);
    success = result.success;
    output = result.success
      ? { ...result.output, side_effects: result.side_effects ?? [] }
      : { ...result.output, error: result.error ?? "tool failed" };
    stepOutput = { success, ...output };
    return { success, output };
  } finally {
    await insertStep(params.db, {
      orgId: params.orgId,
      runId: call.runId,
      orderIndex: call.orderIndex,
      stepType: "tool",
      toolId: call.tool?.id ?? null,
      nativeHandler,
      input: call.input,
      output: stepOutput ?? { success, ...output },
      durationMs: Date.now() - startedAt,
    });
  }
}

async function createRun(params: ExecuteAgentParams) {
  const { data, error } = await params.db
    .from("agent_runs")
    .insert({
      organization_id: params.orgId,
      agent_conversation_id: params.agentConversation.id,
      inbound_message_id: params.inboundMessageId,
      status: "pending",
      model: params.config.model,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "failed to create agent run");
  return data as { id: string };
}

async function updateRunStatus(
  db: AgentDb,
  runId: string,
  orgId: string,
  status: AgentRunStatus,
): Promise<void> {
  await db
    .from("agent_runs")
    .update({ status })
    .eq("id", runId)
    .eq("organization_id", orgId);
}

async function finishRun(
  params: ExecuteAgentParams,
  result: {
    runId: string;
    status: AgentRunStatus;
    startedAt: number;
    tokensInput: number;
    tokensOutput: number;
    errorMsg?: string;
  },
): Promise<Omit<ExecuteAgentResult, "assistantReply" | "nextStageId">> {
  const durationMs = Date.now() - result.startedAt;
  const costUsdCents = calculateCostUsdCents(
    params.config.model,
    result.tokensInput,
    result.tokensOutput,
  );
  await params.db
    .from("agent_runs")
    .update({
      status: result.status,
      tokens_input: result.tokensInput,
      tokens_output: result.tokensOutput,
      cost_usd_cents: costUsdCents,
      duration_ms: durationMs,
      error_msg: result.errorMsg ?? null,
    })
    .eq("id", result.runId)
    .eq("organization_id", params.orgId);
  await updateConversationUsage({
    db: params.db,
    orgId: params.orgId,
    agentConversationId: params.agentConversation.id,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
  });
  logInfo("native_agent_run_finished", {
    organization_id: params.orgId,
    request_id: params.requestId ?? null,
    run_id: result.runId,
    status: result.status,
    tokens_input: result.tokensInput,
    tokens_output: result.tokensOutput,
    cost_usd_cents: costUsdCents,
    duration_ms: durationMs,
  });
  return {
    runId: result.runId,
    status: result.status,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
    costUsdCents,
    error: result.errorMsg,
  };
}

async function insertStep(
  db: AgentDb,
  step: {
    orgId: string;
    runId: string;
    orderIndex: number;
    stepType: AgentStepType;
    toolId?: string | null;
    nativeHandler?: string | null;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    durationMs: number;
  },
): Promise<void> {
  await db.from("agent_steps").insert({
    organization_id: step.orgId,
    run_id: step.runId,
    order_index: step.orderIndex,
    step_type: step.stepType,
    tool_id: step.toolId ?? null,
    native_handler: step.nativeHandler ?? null,
    input: step.input,
    output: step.output,
    duration_ms: step.durationMs,
  });
}

async function loadWebhookAllowlist(db: AgentDb, orgId: string): Promise<string[]> {
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !data) return [];
  return getWebhookAllowlistDomains((data as { settings?: unknown }).settings);
}

function buildSystemPrompt(config: AgentConfig, stage: AgentStage): string {
  return [
    config.system_prompt,
    "",
    `Etapa atual: ${stage.situation}`,
    stage.instruction,
    stage.transition_hint ? `Dica de transicao: ${stage.transition_hint}` : "",
    "Responda ao cliente em portugues brasileiro, de forma objetiva e util.",
    "Use ferramentas apenas quando a acao for necessaria e permitida.",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractToolCalls(response: any): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  return (response.content ?? [])
    .filter((block: any) => block?.type === "tool_use")
    .map((block: any) => ({
      id: String(block.id),
      name: String(block.name),
      input: block.input && typeof block.input === "object" ? block.input : {},
    }));
}

function extractText(response: any): string {
  return (response.content ?? [])
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("\n")
    .trim();
}

function readUsage(response: any): { input: number; output: number } {
  return {
    input: Number(response.usage?.input_tokens ?? 0),
    output: Number(response.usage?.output_tokens ?? 0),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new GuardrailError("run_cost_timeout", "AI agent execution timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
