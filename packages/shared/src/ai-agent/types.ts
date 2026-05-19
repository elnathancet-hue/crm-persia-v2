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

import type { HandoffNotificationTargetType } from "./handoff";
import type { HumanizationConfig } from "./humanization";

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
  "move_pipeline_stage",
  // PR-AGENDA-TOOLS (mai/2026): handlers de agenda — destravam
  // agendamento/listagem/cancelamento/reagendamento via chat WhatsApp.
  // Migration 040 estende o CHECK constraint do agent_tools.native_handler
  // pra aceitar esses 4 valores.
  "create_appointment",
  "list_lead_appointments",
  "cancel_appointment",
  "reschedule_appointment",
  // PR-AI-AGENT-HUMAN-D (mai/2026): agente envia midia (imagem, PDF,
  // video, audio) da biblioteca automation_tools. Migration 043 estende
  // o CHECK constraint.
  "send_media",
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
  model: string;                 // e.g. "gpt-5-mini" — see MODEL_PRICING in cost.ts
  system_prompt: string;
  guardrails: AgentGuardrails;
  // PR5.5: per-agent debounce window for inbound message aggregation.
  // Optional at the TS level so existing runtime code and test fixtures
  // keep compiling during rollout. Migration 019 sets the DB column to
  // NOT NULL DEFAULT 10000, so real rows always have a value — runtime
  // still guards with `config.debounce_window_ms ?? DEBOUNCE_WINDOW_MS_DEFAULT`
  // for the transition window. Range enforced by `clampDebounceWindowMs`.
  debounce_window_ms?: number;
  // PR5.7: per-agent context summarization thresholds. Migration 020 sets
  // NOT NULL DEFAULT values; optional at the TS level during rollout.
  // Runtime guards with `?? DEFAULT_CONTEXT_SUMMARIZATION.*` plus clamp
  // helpers in `summarization.ts`.
  context_summary_turn_threshold?: number;
  context_summary_token_threshold?: number;
  context_summary_recent_messages?: number;
  // PR5.6: handoff notification config. Migration 021 adds the columns with
  // enabled DEFAULT false, target fields NULL, template NULL (runtime falls
  // back to HANDOFF_DEFAULT_TEMPLATE when NULL or empty).
  handoff_notification_enabled?: boolean;
  handoff_notification_target_type?: HandoffNotificationTargetType | null;
  handoff_notification_target_address?: string | null;
  handoff_notification_template?: string | null;
  // PR7.3: per-agent Google Calendar assignment. Migration 026 adds the
  // column nullable. Quando null, handler `schedule_event` retorna erro
  // de "calendario nao configurado". UI permite escolher entre
  // conexoes da org no editor do agente.
  calendar_connection_id?: string | null;
  // PR-AI-AGENT-HUMAN-A: humanizacao da IA pra parecer SDR. Migration
  // 041 adiciona JSONB com defaults. Optional aqui pra tolerar rows
  // antigos durante rollout — runtime sempre passa pelo
  // normalizeHumanizationConfig (humanization.ts) que aplica defaults.
  // JSONB cresce com PRs B/C/D (split, business hours, etc).
  humanization_config?: HumanizationConfig;
  // PR-AGENT-INTEGRATION-3 (mai/2026): agente principal. Unico TRUE por
  // org (unique partial index). Recebe primeira msg + roteia pra
  // secundarios baseado em agent_entry_conditions. Default false na
  // migration 044.
  is_primary?: boolean;
  // PR-AGENT-INTEGRATION-4 (mai/2026): modelo de execucao.
  //   "stages" (legado): cada agent_stage e sub-prompt que troca o
  //     contexto do LLM por turno.
  //   "actions" (novo): system_prompt fixo. Cada agent_stage tem
  //     action_type que diz qual acao tomar (qualificar/enviar/etc).
  // Default "stages" na migration 046. Wizard novo nasce com "actions".
  behavior_mode?: "stages" | "actions";
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
  // PR6 RAG: per-stage retrieval knob. Migration 022 sets NOT NULL DEFAULT 3.
  // Optional at the TS level during rollout; runtime guards with
  // `clampRagTopK(stage.rag_top_k)` from rag.ts.
  rag_top_k?: number;
  // PR-AGENT-INTEGRATION-4 (mai/2026): tipo de acao quando o agente
  // pai esta em behavior_mode='actions'. Ignorado em mode='stages'.
  // Validacao cruzada feita na aplicacao.
  action_type?: AgentActionType | null;
  // PR-AI-AGENT-STAGE-ACTION-CONFIG (mai/2026): lista de acoes que
  // disparam AUTOMATICAMENTE ao entrar nesta etapa. Migration 049
  // adiciona com default '{}' (= sem acoes — comportamento atual).
  // Runtime SEMPRE normaliza via normalizeStageActionConfig antes de
  // usar (ver stage-actions.ts).
  action_config?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// PR-AGENT-INTEGRATION-4: tipos de acao tipada. Cada uma mapeia pra um
// comportamento que o LLM ja sabe executar via tools nativas + injecao
// no prompt — nao precisa de prompt customizado.
export const AGENT_ACTION_TYPES = [
  "qualify",
  "send_material",
  "schedule",
  "add_tag",
  "move_pipeline",
  "transfer",
  "free_message",
] as const;

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

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
  // PR5.7: counters since last summary write. Reset to 0 when a fresh
  // summary is persisted. Optional during rollout; migration 020 adds the
  // columns with NOT NULL DEFAULT 0 / NULL.
  history_summary_updated_at?: string | null;
  history_summary_run_count?: number;
  history_summary_token_count?: number;
  variables: Record<string, unknown>; // key/value extracted facts (nome, email, etc)
  tokens_used_total: number;      // cumulative, for org-level cost views
  last_interaction_at: string | null;
  // PR-AI-AGENT-STAGE-ACTION-CONFIG (mai/2026): stage_ids onde as
  // auto_actions ja foram disparadas. Garante idempotencia se a
  // conversa volta a entrar na mesma etapa (raro via transfer_to_stage).
  // Migration 049 adiciona com default '[]'. Runtime normaliza via
  // normalizeActionsExecuted antes de usar.
  actions_executed?: string[];
  // PR3 (mai/2026): per-action retry tracking. Shape detalhado em
  // `ActionsExecutedDetail` (vide ai-agent/stage-actions.ts). Migration
  // 053 adiciona com default '{}'. Runtime normaliza via
  // normalizeActionsExecutedDetail antes de usar.
  actions_executed_detail?: Record<string, unknown>;
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
  // PR-AI-AGENT-TESTER-FAITHFUL (mai/2026): true quando o run veio do
  // Tester (UI de simulacao). Migration 047 adiciona com default false.
  // Dashboards de custo/uso filtram com is_test=false pra ver so prod.
  is_test?: boolean;
}

// ============================================================================
// Step audit (agent_steps row) — one per LLM call, tool call, or guardrail trip
// ============================================================================

// PR5.7: added "summarization" for context consolidation steps. Migration 020
// relaxes the DB check constraint to accept the new value.
export type AgentStepType = "llm" | "tool" | "guardrail" | "summarization";

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
// Tester FIEL (PR-AI-AGENT-TESTER-FAITHFUL, mai/2026) — executa o pipeline
// REAL (tryEnqueueForNativeAgent + executeDebouncedBatch) com provider stub
// que captura eventos em memoria. Reproduz pause/resume, business hours,
// debounce, split (picotar) e delay entre msgs — exatamente como prod.
// ============================================================================

export interface TesterLiveRequest {
  config_id: string;
  message: string;
  /** Quando true (default), forca flush imediato apos enqueue (skip
   * debounce window real). Quando false, espera o debounce_window_ms
   * configurado do agente — pra reproduzir bug de timing. */
  expedite_debounce: boolean;
}

export type TesterEventKind =
  | "send_text"
  | "set_typing_on"
  | "set_typing_off"
  | "send_media"
  | "skipped";

export interface TesterEvent {
  /** Timestamp absoluto em ms (Date.now() no servidor). UI calcula
   * delays relativos entre eventos. */
  ts: number;
  kind: TesterEventKind;
  /** Conteudo do evento. Para send_text: { message: string }. Para
   * send_media: { url, kind, caption }. Para skipped: { reason }. */
  payload: Record<string, unknown>;
}

export type TesterSkipReason =
  | "feature_flag_off"
  | "no_active_config"
  | "paused_by_keyword"
  | "paused_active"
  | "after_hours"
  | "native_agent_handoff"
  | "rate_limited"
  | "cost_ceiling"
  | "other";

export interface TesterLiveResponse {
  /** Run criado em agent_runs (com is_test=true), null quando pulou
   * antes de chegar ao executor (ex: pause keyword). */
  run_id: string | null;
  /** Timeline de eventos do provider stub. Ordem cronologica. */
  events: TesterEvent[];
  /** Outcome do tryEnqueueForNativeAgent. Quando handled=true e
   * skipped esta setado, o agente nao processou (ex: pausado). */
  skipped?: TesterSkipReason;
  steps: TesterStepSummary[];
  next_stage_id: string | null;
  tokens_used: number;
  cost_usd_cents: number;
  /** Snapshot do humanization_config aplicado (pra UI exibir
   * "voce esta usando split=on com threshold=200"). */
  applied_config: {
    split_enabled: boolean;
    split_threshold_chars: number;
    split_delay_seconds: number;
    business_hours_enabled: boolean;
    pause_keywords: string[];
    resume_keywords: string[];
  };
  /** Quando pause keyword bateu OU business hours bloqueou, descreve
   * o motivo em PT-BR pra UI mostrar banner amigavel. */
  human_message?: string;
  error?: string;
}

// ============================================================================
// Feature flag — lives in public.organizations.settings (JSONB).
// No new table for flags in PR1.
// ============================================================================

export interface OrganizationAgentFeatures {
  native_agent_enabled?: boolean;
}

// PR5: optional webhook domain allowlist. When present, the webhook caller
// only accepts outbound calls whose resolved hostname matches (case-insensitive)
// one of these entries. When absent or empty, the caller rejects ALL custom
// webhook invocations — opt-in by org, no silent fleet-wide allow.
export interface OrganizationWebhookAllowlist {
  domains?: string[]; // lowercased hostnames, e.g. ["n8n.example.com"]
}

export interface OrganizationSettings {
  features?: OrganizationAgentFeatures;
  webhook_allowlist?: OrganizationWebhookAllowlist;
  [key: string]: unknown;
}

export const NATIVE_AGENT_FEATURE_FLAG = "native_agent_enabled" as const;
export const WEBHOOK_ALLOWLIST_KEY = "webhook_allowlist" as const;

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
  // PR5.5: optional. Runtime defaults to DEBOUNCE_WINDOW_MS_DEFAULT when
  // omitted and clamps to [DEBOUNCE_WINDOW_MS_MIN, DEBOUNCE_WINDOW_MS_MAX].
  debounce_window_ms?: number;
  // PR5.7: optional. Runtime defaults + clamp via summarization.ts helpers.
  context_summary_turn_threshold?: number;
  context_summary_token_threshold?: number;
  context_summary_recent_messages?: number;
  // PR5.6: optional. Runtime validates: target address when enabled, phone
  // digit count within [HANDOFF_PHONE_MIN_DIGITS, HANDOFF_PHONE_MAX_DIGITS],
  // template length <= HANDOFF_TEMPLATE_MAX_LENGTH.
  handoff_notification_enabled?: boolean;
  handoff_notification_target_type?: HandoffNotificationTargetType | null;
  handoff_notification_target_address?: string | null;
  handoff_notification_template?: string | null;
  // PR7.3: opcional. Server valida que connection_id pertence a mesma
  // org e esta active.
  calendar_connection_id?: string | null;
  // PR-AI-AGENT-HUMAN-A: opcional. Runtime aplica defaults via
  // normalizeHumanizationConfig (humanization.ts). Server faz merge
  // shallow com o config existente.
  humanization_config?: Partial<HumanizationConfig>;
  // PR onboarding: opcional. Quando informado e nao-blank, server cria
  // stages pre-definidas (ver agent-templates.ts) junto com o config.
  // O system_prompt continua vindo do client (cliente preenche com o
  // prompt do template no form). Template apenas materializa stages.
  template_slug?: import("./agent-templates").AgentTemplateSlug;
  // PR-AGENT-INTEGRATION-4: modelo de execucao. Default 'stages' pra
  // retrocompat. Wizard novo passa 'actions'.
  behavior_mode?: "stages" | "actions";
}

export interface UpdateAgentInput extends Partial<CreateAgentInput> {
  status?: AgentStatus;
}

export interface CreateStageInput {
  situation: string;
  instruction: string;
  transition_hint?: string;
  rag_enabled?: boolean;
  // PR6: optional. Runtime clamps via clampRagTopK (1..10, default 3).
  rag_top_k?: number;
  order_index?: number;
  slug?: string;
  // PR-AGENT-INTEGRATION-4: tipo de acao. So usado quando o agente pai
  // esta em behavior_mode='actions'. Server valida cruzado.
  action_type?: AgentActionType | null;
}

export interface UpdateStageInput extends Partial<CreateStageInput> {}

export interface ReorderStagesInput {
  config_id: string;
  stage_ids: string[]; // in desired order
}

// --- PR3 additions: tool CRUD + stage-tool allowlist management ---

export interface CreateToolInput {
  config_id: string;
  name: string;
  description: string;
  input_schema: JSONSchemaObject;
  execution_mode: ToolExecutionMode;
  native_handler?: NativeHandlerName;
  webhook_url?: string;
  webhook_secret?: string;
  is_enabled?: boolean;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  input_schema?: JSONSchemaObject;
  execution_mode?: ToolExecutionMode;
  native_handler?: NativeHandlerName | null;
  webhook_url?: string | null;
  webhook_secret?: string | null;
  is_enabled?: boolean;
}

// Convenience input for creating a native tool from a preset. The runtime
// action materializes the preset into a full CreateToolInput server-side, so
// the UI does not need to duplicate schema wiring.
export interface CreateToolFromPresetInput {
  config_id: string;
  handler: NativeHandlerName;
}

// PR5: focused DTO for creating a custom webhook tool. The runtime action
// maps this to CreateToolInput with execution_mode='n8n_webhook' and runs
// the SSRF + allowlist validation.
export interface CreateCustomWebhookToolInput {
  config_id: string;
  name: string;                   // tool.name, exposed to LLM
  description: string;            // LLM-facing description
  input_schema: JSONSchemaObject;
  webhook_url: string;            // HTTPS only, hostname must match allowlist
  webhook_secret: string;         // min 32 chars (HMAC key). Runtime validates length.
}

export interface UpdateCustomWebhookToolInput {
  name?: string;
  description?: string;
  input_schema?: JSONSchemaObject;
  webhook_url?: string;
  webhook_secret?: string;        // undefined = keep, "" = clear (runtime rejects)
  is_enabled?: boolean;
}

export interface SetStageToolInput {
  stage_id: string;
  tool_id: string;
  is_enabled: boolean;
}

// PR5: org-level webhook allowlist management.
export interface AddAllowedDomainInput {
  domain: string; // normalized server-side (lowercase, stripped of scheme/path/port)
}

export const WEBHOOK_SECRET_MIN_LENGTH = 32 as const;

// --- PR3 additions: audit queries for agent runs / steps ---

export interface ListRunsInput {
  config_id?: string;
  agent_conversation_id?: string;
  lead_id?: string;
  limit?: number;  // default 20, max 100
  since?: string;  // ISO-8601 datetime; only runs created after this
}

// Audit shape returned to the UI. Steps are included so the audit drawer can
// render without an extra round trip for typical list sizes (<=100 runs).
export interface AgentRunWithSteps extends AgentRun {
  steps: AgentStep[];
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
  // PR-AGENDA-TOOLS (mai/2026): adicionado "date-time" pros handlers de
  // agenda (create_appointment + reschedule_appointment recebem ISO 8601).
  | { type: "string"; description?: string; enum?: readonly string[]; format?: "uuid" | "email" | "uri" | "date-time" }
  | { type: "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: JSONSchemaProperty }
  | { type: "object"; description?: string; properties?: Record<string, JSONSchemaProperty>; required?: string[] };
