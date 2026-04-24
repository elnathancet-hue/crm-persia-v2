// AI Agent — tool-use contracts.
//
// OpenAI Chat Completions tool-use format. JSON schema stays compatible
// with Anthropic's (same `input_schema` shape), but the wire wrapper and
// response payload differ. Runtime (apps/crm) may use Zod internally and
// emit JSONSchemaObject via zod-to-json-schema when creating tools.

import type {
  AgentTool,
  JSONSchemaObject,
  NativeHandlerName,
} from "./types";

// ============================================================================
// OpenAI Chat Completions tool wire format
// Sent to openai.chat.completions.create({ tools: [...] }).
// ============================================================================

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchemaObject;
  };
}

export function toOpenAITool(tool: AgentTool): OpenAITool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

// ============================================================================
// DEPRECATED — Anthropic tool wire format.
//
// Kept alongside the OpenAI types during the full-swap migration so the
// current runtime (still wired to @anthropic-ai/sdk) keeps compiling
// between this contracts PR and the Codex runtime PR. Will be removed in
// the runtime PR.
// ============================================================================

/** @deprecated Use OpenAITool. Removed after runtime migration. */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: JSONSchemaObject;
}

/** @deprecated Use toOpenAITool. Removed after runtime migration. */
export function toAnthropicTool(tool: AgentTool): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}

// ============================================================================
// Tool call / tool result — normalized shapes the executor exchanges with
// the runtime handlers. The runtime translates OpenAI's wire payload
// (`choices[0].message.tool_calls[]` with stringified `function.arguments`)
// into these normalized shapes before invoking handlers.
// ============================================================================

export interface ToolCall {
  id: string;                        // OpenAI tool_call id ("call_abc123");
                                     // was Anthropic tool_use_id on the legacy runtime
  name: string;                      // must match tool.function.name
  input: Record<string, unknown>;    // parsed from OpenAI's JSON-string arguments
}

export interface ToolResult {
  // Legacy field name kept for the current Anthropic-based runtime until
  // the Codex OpenAI-runtime PR lands. New code should set `tool_call_id`.
  // Runtime will deprecate `tool_use_id` after the swap.
  tool_use_id?: string;
  tool_call_id?: string;
  content: string | Record<string, unknown>;
  is_error: boolean;
}

// ============================================================================
// Native handler contract — implemented in apps/crm/src/lib/ai-agent/handlers
//
// Hard rules for handler authors:
//   1. NEVER trust the LLM: validate every arg against the tool's schema
//      AND against org/lead ownership.
//   2. NEVER read/write rows outside the current organization_id.
//   3. Persist the step via the executor — handlers do NOT touch agent_steps
//      directly, they return NativeHandlerResult and the executor audits.
//   4. When context.dry_run === true: simulate, do NOT send messages, do NOT
//      mutate CRM state. Return what would happen.
//   5. Fail soft: throw only for unrecoverable bugs. Expected failures
//      (missing user, permission denied) go in NativeHandlerResult.error
//      with success: false, so the LLM can react.
// ============================================================================

export interface NativeHandlerContext {
  organization_id: string;
  lead_id: string;
  crm_conversation_id: string;
  agent_conversation_id: string;
  run_id: string;
  dry_run: boolean;
}

export interface NativeHandlerResult {
  success: boolean;
  output: Record<string, unknown>;
  side_effects?: string[];  // human-readable audit (e.g., ["tagged lead with #qualified"])
  error?: string;           // present iff success === false
}

export type NativeHandler = (
  context: NativeHandlerContext,
  input: Record<string, unknown>,
) => Promise<NativeHandlerResult>;

// Registry shape — the runtime provides a static map.
// Using Partial so the spike can ship with only stop_agent.
export type NativeHandlerRegistry = Readonly<
  Partial<Record<NativeHandlerName, NativeHandler>>
>;

// ============================================================================
// Custom webhook tool contract (execution_mode === 'n8n_webhook')
//
// SECURITY: all these checks MUST be enforced by the webhook caller in
// apps/crm/src/lib/ai-agent/webhook-caller.ts (to be built in PR5). Listed
// here so the contract is visible to both UI and Runtime reviewers.
// ============================================================================

export interface CustomWebhookInvocation {
  tool_id: string;
  webhook_url: string;           // MUST be validated HTTPS + non-private IP
  webhook_secret: string;        // used for HMAC-SHA256 X-Persia-Signature
  payload: Record<string, unknown>;
  context: NativeHandlerContext;
}

export interface CustomWebhookResult {
  success: boolean;
  output: Record<string, unknown>;
  http_status: number;
  duration_ms: number;
  error?: string;
}

export const CUSTOM_WEBHOOK_LIMITS = {
  timeout_ms: 10_000,
  max_response_bytes: 256 * 1024,
  signature_header: "X-Persia-Signature",
  signature_algo: "sha256",
} as const;
