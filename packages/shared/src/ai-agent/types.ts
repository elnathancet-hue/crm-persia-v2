// AI Agent — shared domain types.
//
// READ-ONLY for runtime agents (Codex) after this PR merges. Any change to
// these types must go through a dedicated "contract change" PR with review
// from both UI and Runtime owners. See CODEX_SYNC.md for the protocol.
//
// Consumed by:
//   - apps/crm/src/lib/ai-agent/*          (executor, handlers — Codex)
//   - apps/crm/src/actions/ai-agent/*      (server actions — Codex)
//   - apps/crm/src/app/(dashboard)/agents  (UI — Claude)
//   - apps/crm/src/features/ai-agent/*     (components — Claude)

// ============================================================================
// Native handler registry (enum) — MUST match DB check constraint in
// apps/crm/supabase/migrations/017_ai_agent_core.sql
// Adding a new handler = new migration + new entry here + new TS handler.
// ============================================================================

export const NATIVE_HANDLERS = [
  "transfer_to_user",
  "transfer_to_stage",
  "transfer_to_agent",
  "add_tag",
  "assign_source",
  "assign_product",
  "assign_department",
  "round_robin_user",
  "round_robin_agent",
  "send_audio",
  "trigger_notification",
  "schedule_event",
  "stop_agent",
] as const;

export type NativeHandlerName = (typeof NATIVE_HANDLERS)[number];

// PR1 spike ships only these. Everything else is enum-only until its PR.
export const SPIKE_NATIVE_HANDLERS = ["stop_agent"] as const satisfies readonly NativeHandlerName[];

// ============================================================================
// Tool execution modes
// ============================================================================

export type ToolExecutionMode = "native" | "n8n_webhook";

// ============================================================================
// Agent status
// ============================================================================

export type AgentStatus = "draft" | "active" | "paused";

export type AgentScopeType = "department" | "pipeline" | "global";

// ============================================================================
// Guardrails — enforced by executor, not by the LLM
// ============================================================================

export interface AgentGuardrails {
  max_iterations: number;       // tool-use loop cap; default 5 on spike
  timeout_seconds: number;      // per-run wall clock; default 30
  cost_ceiling_tokens: number;  // per-run token budget (in+out); default 20000
  allow_human_handoff: boolean; // if false, agent never calls stop_agent
}

export const DEFAULT_GUARDRAILS: AgentGuardrails = {
  max_iterations: 5,
  timeout_seconds: 30,
  cost_ceiling_tokens: 20_000,
  allow_human_handoff: true,
};

// ============================================================================
// Agent configuration (agent_configs row)
// ============================================================================

export interface AgentConfig {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  scope_type: AgentScopeType;
  scope_id: string | null;      // references department or pipeline; null if global
  model: string;                 // e.g. "claude-sonnet-4-6"
  system_prompt: string;
  guardrails: AgentGuardrails;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Stage (agent_stages row) — conversation state machine node
// ============================================================================

export interface AgentStage {
  id: string;
  config_id: string;
  organization_id: string;
  slug: string;                   // url-friendly id, unique per config
  order_index: number;
  situation: string;              // human label, e.g. "Boas-vindas"
  instruction: string;            // prompt fragment appended to system on this stage
  transition_hint: string | null; // natural-language hint to LLM about when to move on
  rag_enabled: boolean;           // if true, retrieve FAQ/docs before LLM call
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Tool (agent_tools row) + stage-tool junction (agent_stage_tools row)
// ============================================================================

export interface AgentTool {
  id: string;
  config_id: string;
  organization_id: string;
  name: string;                   // unique per config; exposed to LLM
  description: string;            // LLM-facing description
  input_schema: JSONSchemaObject; // Anthropic-compatible JSON Schema
  execution_mode: ToolExecutionMode;
  native_handler: NativeHandlerName | null; // required when mode='native'
  webhook_url: string | null;     // required when mode='n8n_webhook'
  webhook_secret: string | null;  // HMAC-SHA256 shared secret
  is_enabled: boolean;            // global switch per tool
  created_at: string;
  updated_at: string;
}

export interface AgentStageTool {
  stage_id: string;
  tool_id: string;
  organization_id: string;
  is_enabled: boolean;
}

// ============================================================================
// Conversation state (agent_conversations row)
// One row per CRM conversation that has been handled by the agent at least once.
// References conversations.id — does NOT store messages. Messages live in
// public.messages (CRM canonical).
// ============================================================================

export interface AgentConversation {
  id: string;
  organization_id: string;
  crm_conversation_id: string;   // references public.conversations(id)
  lead_id: string;                // references public.leads(id)
  config_id: string;
  current_stage_id: string | null;
  history_summary: string | null; // rolling summary, compacted periodically
  variables: Record<string, unknown>; // key/value extracted facts (nome, email, etc)
  tokens_used_total: number;      // cumulative, for org-level cost views
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Run audit (agent_runs row) — one per inbound message execution
// ============================================================================

export type AgentRunStatus =
  | "pending"     // row inserted, not yet picked up
  | "running"     // executor working
  | "succeeded"   // reply sent
  | "failed"      // caught exception; executor fell back to legacy
  | "fallback"    // guardrail hit; handoff to human or legacy
  | "canceled";   // user/admin canceled mid-run (future)

export interface AgentRun {
  id: string;
  organization_id: string;
  agent_conversation_id: string;
  inbound_message_id: string | null; // references public.messages(id); null for tester
  status: AgentRunStatus;
  model: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd_cents: number;
  duration_ms: number;
  error_msg: string | null;
  created_at: string;
}

// ============================================================================
// Step audit (agent_steps row) — one per LLM call, tool call, or guardrail trip
// ============================================================================

export type AgentStepType = "llm" | "tool" | "guardrail";

export interface AgentStep {
  id: string;
  organization_id: string;
  run_id: string;
  order_index: number;
  step_type: AgentStepType;
  tool_id: string | null;                   // when step_type='tool'
  native_handler: NativeHandlerName | null; // when tool is native
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  duration_ms: number;
  created_at: string;
}

// ============================================================================
// Tester contract — UI calls this; runtime executes without sending real
// messages unless dry_run === false AND caller has elevated permission.
// ============================================================================

export interface TesterRequest {
  config_id: string;
  stage_id?: string;                    // optional; defaults to conversation's current or first stage
  message: string;
  conversation_state?: TesterConversationStateInput;
  dry_run: boolean;                     // true → tool side-effects simulated, not executed
}

export interface TesterConversationStateInput {
  current_stage_id: string | null;
  history_summary: string | null;
  variables: Record<string, unknown>;
}

export interface TesterResponse {
  run_id: string;
  status: AgentRunStatus;
  assistant_reply: string;              // final text the bot would send
  steps: TesterStepSummary[];
  tokens_used: number;
  cost_usd_cents: number;
  next_stage_id: string | null;         // stage after this run, if transitioned
  error?: string;
}

export interface TesterStepSummary {
  step_type: AgentStepType;
  tool_name?: string;
  native_handler?: NativeHandlerName;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration_ms: number;
}

// ============================================================================
// Feature flag — lives in public.organizations.settings (JSONB).
// No new table for flags in PR1.
// ============================================================================

export interface OrganizationAgentFeatures {
  native_agent_enabled?: boolean;
}

export interface OrganizationSettings {
  features?: OrganizationAgentFeatures;
  [key: string]: unknown;
}

export const NATIVE_AGENT_FEATURE_FLAG = "native_agent_enabled" as const;

// ============================================================================
// Server action input DTOs (consumed by UI, implemented by Codex)
// ============================================================================

export interface CreateAgentInput {
  name: string;
  description?: string;
  scope_type: AgentScopeType;
  scope_id?: string;
  model: string;
  system_prompt: string;
  guardrails?: Partial<AgentGuardrails>;
}

export interface UpdateAgentInput extends Partial<CreateAgentInput> {
  status?: AgentStatus;
}

export interface CreateStageInput {
  situation: string;
  instruction: string;
  transition_hint?: string;
  rag_enabled?: boolean;
  order_index?: number;
  slug?: string;
}

export interface UpdateStageInput extends Partial<CreateStageInput> {}

export interface ReorderStagesInput {
  config_id: string;
  stage_ids: string[]; // in desired order
}

// ============================================================================
// JSON Schema shape (Anthropic tool-use compatible subset)
// Intentionally narrow — we do not support the full JSON Schema spec.
// ============================================================================

export interface JSONSchemaObject {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export type JSONSchemaProperty =
  | { type: "string"; description?: string; enum?: readonly string[]; format?: "uuid" | "email" | "uri" }
  | { type: "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: JSONSchemaProperty }
  | { type: "object"; description?: string; properties?: Record<string, JSONSchemaProperty>; required?: string[] };
