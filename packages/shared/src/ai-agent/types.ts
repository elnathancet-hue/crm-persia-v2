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
import type { ValidationConfig } from "./validation";

// ============================================================================
// Structured Sources — fontes de dados tipadas (migration 113)
// ============================================================================

export type StructuredSourceType = "mcp" | "json";

/**
 * Categorias de dado inline (JSON). Usadas no system prompt block pra
 * dar contexto ao LLM sobre o que cada fonte representa.
 */
export type JsonDataType =
  | "pricing_tables"
  | "products"
  | "services"
  | "support_tables"
  | "business_rules"
  | "templates"
  | "promotions"
  | "custom";

interface BaseStructuredSource {
  /** UUID gerado no client (nanoid). Estável entre edições. */
  id: string;
  /** Nome amigável exibido na UI e no prompt. */
  name: string;
  type: StructuredSourceType;
  enabled: boolean;
  /** Descrição curta: quando / por que usar esta fonte. */
  description?: string;
}

/**
 * Fonte MCP: referência a um mcp_server_connection existente.
 * O runtime filtra as tools expostas ao LLM pelo `allowed_tools` —
 * se vazio, todas as tools do servidor ficam disponíveis.
 */
export interface McpStructuredSource extends BaseStructuredSource {
  type: "mcp";
  config: {
    /** ID de mcp_server_connections (organization-scoped). */
    mcp_id: string;
    /** Lista branca de tool names. [] = todas as tools do servidor. */
    allowed_tools: string[];
  };
}

/**
 * Fonte JSON inline: dados embutidos diretamente no agente.
 * Injetados no system prompt via get_structured_source_data tool.
 */
export interface JsonStructuredSource extends BaseStructuredSource {
  type: "json";
  data_type: JsonDataType;
  /** Objeto JSON arbitrário (tabelas, produtos, regras, etc.). */
  data: Record<string, unknown>;
}

export type StructuredSource = McpStructuredSource | JsonStructuredSource;

// ============================================================================
// Message Templates — reutilizáveis por agente (migration 100)
// ============================================================================

/**
 * Template de mensagem cadastrado no agente.
 *
 * mode=ai_suggestion: injetado no system prompt do AI node como bloco
 *   contextual de referência. A IA ainda pode adaptar o texto.
 *
 * mode=fixed_response: enviado exatamente como está pelo action node
 *   send_template_message — sem chamar a IA.
 */
export interface MessageTemplate {
  /** Slug único dentro do agente. Ex: "apresentacao_plano". */
  key: string;
  /** Nome exibido na UI. Ex: "Apresentação do Plano". */
  name: string;
  /** Descrição de quando usar (aparece no prompt pra ai_suggestion). */
  usage?: string;
  mode: "ai_suggestion" | "fixed_response";
  /** Texto da mensagem. Suporta {{lead.name}}, {{lead.phone}}, {{lead.email}}. */
  message: string;
}

// ============================================================================
// Native handler registry (enum) — MUST match DB check constraint in
// apps/crm/supabase/migrations/017_ai_agent_core.sql
// Adding a new handler = new migration + new entry here + new TS handler.
// ============================================================================

export const NATIVE_HANDLERS = [
  "transfer_to_user",
  // PR-FLOW-PIVOT (mai/2026): "transfer_to_stage" removido. No modelo
  // flow não há stages — edges nomeadas do canvas substituem.
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
  // PR-FLOW-PIVOT PR 7 (mai/2026): tool que a IA chama pra avançar pra
  // um handle nomeado do AI node no canvas. Cliente cadastra `instructions[]`
  // no NodeConfigSheet (cada item tem output_handle + descrição). Quando
  // a IA "cumpre" a instrução semanticamente, chama emit_event(handle_name)
  // e o runtime segue a edge correspondente. Sem side effect — só
  // sinalização pro flow-runner.
  "emit_event",
  // PR-FLOW-PIVOT PR 8 (mai/2026): IA escreve em lead_custom_field_values.
  // Paridade com `edit_lead_ia: true` do flow.json do Jordan. Handler resolve
  // custom_field pelo field_key (slug) e faz upsert no value (TEXT).
  "set_lead_custom_field",
  // PR-6 Auditoria (mai/2026): handler novo pra fechar gap da rodada 1 #3 +
  // rodada 4 matriz. Ja existia no FlowActionType + UI mostrava o card,
  // mas runtime nao tinha handler — guardrail event silencioso. Agora
  // espelha add_tag: DELETE em lead_tags + lead_activity audit.
  "remove_tag",
  // Auditoria Automacoes (jun/2026): fecha conversa (status='closed') sem
  // encerrar o agente ou transferir pra humano. Lead continua ativo.
  // Util pra encerrar atendimento quando fluxo termina mas o lead
  // pode voltar (diferente de stop_agent que pausa o agente).
  "close_conversation",
  // Auditoria Agenda (jun/2026): completa o ciclo conversacional de
  // agendamento. get_available_slots elimina tentativa-erro (a IA consulta
  // horarios livres e oferece opcoes ao lead antes de criar). confirm_appointment
  // resolve o status awaiting_confirmation → confirmed quando lead aceita
  // verbalmente, sem exigir acao manual do operador.
  "get_available_slots",
  "confirm_appointment",
] as const;

export type NativeHandlerName = (typeof NATIVE_HANDLERS)[number];

// PR1 spike ships only these. Everything else is enum-only until its PR.
export const SPIKE_NATIVE_HANDLERS = ["stop_agent"] as const satisfies readonly NativeHandlerName[];

// ============================================================================
// Tool execution modes
// ============================================================================

// Backlog #7 Auditoria (mai/2026): adicionado "mcp" — endereca rodada
// 2 #4 do POST_CODEX_AUDIT_AGENT_FLOW_353.md. Migration 062 ja estende
// o CHECK constraint de agent_tools.execution_mode e o flow runner ja
// despacha em runner.ts:dispatchToolCall. Faltava apenas o tipo
// compartilhado pra eliminar a deriva DB↔runtime↔UI.
//
// - native:     handler nativo em apps/crm/src/lib/ai-agent/tools/.
// - n8n_webhook: legacy externo via webhook_url + webhook_secret.
// - mcp:        servidor externo via mcp_server_connections + JSON-RPC.
export type ToolExecutionMode = "native" | "n8n_webhook" | "mcp";

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
// Structured Prompt Config — editor estruturado SDR (migration 124)
// ============================================================================

export type TonePreset =
  | "direct_commercial"
  | "consultive_empathic"
  | "formal_institutional"
  | "casual_youth";

export interface StructuredPromptIdentity {
  agent_name: string;
  company: string;
  segment: string;
  channel: string;
  region: string;
  goal: string;
}

export interface StructuredPromptTone {
  preset: TonePreset;
  custom_instruction: string;
}

export interface StructuredPromptCommercialRule {
  /** UUID gerado no client (nanoid). Estável entre edições. */
  id: string;
  title: string;
  /** Ex: "Pessoa Física (PF)", "PJ / MEI", "Menores de Idade". */
  profile_label: string;
  description: string;
}

/**
 * Configuração estruturada do prompt SDR.
 * compileStructuredPrompt() converte isso no system_prompt final.
 */
export interface StructuredPromptConfig {
  version: 1;
  identity: StructuredPromptIdentity;
  tone: StructuredPromptTone;
  /** Instruções gerais de comportamento (texto livre, variáveis {{agent_name}} etc.). */
  master_prompt: string;
  commercial_rules: StructuredPromptCommercialRule[];
  prohibited_actions: string[];
}

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
  // Optional CRM stage assigned when this agent creates a brand-new lead.
  // NULL keeps the default lead creation behavior.
  new_lead_stage_id?: string | null;
  // PR-FLOW-PIVOT (mai/2026): único valor aceito é 'flow' (canvas
  // visual via @xyflow/react). Substitui o modelo legado de
  // stages/actions. Coluna mantida pra futuro multi-modo.
  behavior_mode?: "flow";
  // Migration 100: templates de mensagem reutilizáveis. Default [] pra
  // compatibilidade com agentes existentes — runtime sempre usa ?? [].
  message_templates?: MessageTemplate[];
  // Migration 101: validação antes do envio. Default {} (disabled) pra
  // compatibilidade — normalizeValidationConfig aplica defaults.
  validation_config?: ValidationConfig;
  // Migration 113: fontes de dados estruturadas (MCP ou JSON inline).
  // Default [] para compatibilidade — runner usa ?? [].
  structured_sources?: StructuredSource[];
  // Migration 124: editor estruturado de prompt SDR. Quando presente,
  // a UI exibe o formulário (identidade, tom, regras, proibições) em vez
  // do textarea de texto corrido. compileStructuredPrompt() gera
  // o system_prompt final ao salvar. null = agente legado.
  structured_prompt_config?: StructuredPromptConfig | null;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Tool (agent_tools row) — junction agent_stage_tools removida no PR-FLOW-PIVOT
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
  mcp_server_id: string | null;   // required when mode='mcp'
  is_enabled: boolean;            // global switch per tool
  created_at: string;
  updated_at: string;
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
  /** PR-FLOW-PIVOT (mai/2026): ID do node ativo no canvas (string client-side
   * do React Flow). Substitui current_stage_id UUID. NULL antes da conversa
   * entrar no flow. */
  current_node_id: string | null;
  history_summary: string | null; // rolling summary, compacted periodically
  // PR5.7: counters since last summary write. Reset to 0 when a fresh
  // summary is persisted. Optional during rollout; migration 020 adds the
  // columns with NOT NULL DEFAULT 0 / NULL.
  history_summary_updated_at?: string | null;
  history_summary_run_count?: number;
  history_summary_token_count?: number;
  variables: Record<string, unknown>; // key/value extracted facts (nome, email, etc)
  // Backlog #13 Auditoria (mai/2026): tokens_used_total removida via
  // migration 073. Era dado morto — nenhum produto consumia, cost-limits
  // e dashboards usam agent_usage_daily (agregado dia + config). Per-
  // conversation ceiling pode ser reconstruida via agent_runs se virar
  // requisito futuro.
  /** Incrementado quando o controle da conversa muda (IA <-> humano).
   * Runs antigos capturam este valor e nao podem enviar se ele mudou. */
  ai_control_epoch?: number;
  last_interaction_at: string | null;
  /** PR-FLOW-PIVOT: node_ids onde auto-actions já dispararam. Idempotência
   * por node. Substitui shape antigo (stage_ids). */
  actions_executed?: string[];
  /** PR3 (mai/2026): per-action retry tracking. Keys agora são
   * "on_enter:<node_id>" ou "on_tool_success:<node_id>:<tool>". Shape
   * detalhado vive no flow-executor runtime. */
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
  /** PR-FLOW-PIVOT: node ID inicial (entry point) opcional. Default = node
   * de tipo 'entry' do flow. */
  node_id?: string;
  message: string;
  conversation_state?: TesterConversationStateInput;
  dry_run: boolean;                     // true → tool side-effects simulated, not executed
}

export interface TesterConversationStateInput {
  current_node_id: string | null;
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
  /** PR-FLOW-PIVOT: ID do próximo node a executar (saiu via edge). */
  next_node_id: string | null;
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

/**
 * PR-FLOW-PIVOT PR 16 (mai/2026): simulação de evento CRM no Tester.
 *
 * Permite testar flows com entry trigger `pipeline_stage_entered` ou
 * `segment_entered` SEM precisar mover lead real / cadastrar tag /
 * etc. Roda o flow a partir do entry node com inbound vazio (igual o
 * runtime real faria quando o hook dispara).
 *
 * `target_id` deve casar com o `entry.config.stage_id` ou
 * `entry.config.segment_id` configurado no flow — senão o Tester
 * retorna skipped pra deixar claro que o trigger não casaria em prod.
 */
export interface TesterSimulateEventRequest {
  config_id: string;
  trigger_type: "pipeline_stage_entered" | "segment_entered";
  /** ID da stage ou segmento alvo. */
  target_id: string;
}

export type TesterEventKind =
  | "send_text"
  | "set_typing_on"
  | "set_typing_off"
  | "send_media"
  | "tool_result"
  | "required_fields_checked"
  | "response_validated"
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
  /** PR-FLOW-PIVOT: node onde o flow parou após este run. */
  next_node_id: string | null;
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
  /**
   * Backlog #6 Auditoria (mai/2026): warnings de paridade entre tester
   * e producao. Tester nao bloqueia em nenhum dos casos — apenas avisa
   * o admin "esse run nao reflete o que aconteceria em prod hoje".
   *
   * Codigos:
   *   - feature_flag_off: org tem native_agent_enabled = false em
   *     organizations.settings.features. Producao iria pro pipeline legacy.
   *   - agent_not_active: agent_configs.status != 'active'. Producao
   *     filtra; tester ignora.
   *   - outside_business_hours: humanization.business_hours_enabled = true
   *     e agora esta fora do range. Producao mandaria after_hours_message.
   *
   * Cada warning tem mensagem PT-BR pra UI mostrar como banner amarelo
   * em cima dos eventos.
   */
  gate_warnings?: Array<{
    code: "feature_flag_off" | "agent_not_active" | "outside_business_hours";
    message: string;
  }>;
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
  // Optional CRM stage for brand-new leads created by this agent.
  new_lead_stage_id?: string | null;
  // PR-AI-AGENT-HUMAN-A: opcional. Runtime aplica defaults via
  // normalizeHumanizationConfig (humanization.ts). Server faz merge
  // shallow com o config existente.
  humanization_config?: Partial<HumanizationConfig>;
  // PR onboarding: opcional. Quando informado e nao-blank, server cria
  // flow pre-definido (ver agent-templates.ts) junto com o config.
  // O system_prompt continua vindo do client. Template apenas
  // materializa nodes/edges no agent_flows.
  template_slug?: import("./agent-templates").AgentTemplateSlug;
  // PR-FLOW-PIVOT: único valor aceito é 'flow'. Default no server.
  behavior_mode?: "flow";
  // Migration 100: lista completa de templates (substitui o array inteiro ao salvar).
  message_templates?: MessageTemplate[];
  // Migration 101: config de validação antes do envio.
  validation_config?: ValidationConfig;
  // Migration 113: fontes de dados estruturadas.
  structured_sources?: StructuredSource[];
  // Migration 124: editor estruturado de prompt SDR.
  structured_prompt_config?: StructuredPromptConfig | null;
}

export interface UpdateAgentInput extends Partial<CreateAgentInput> {
  status?: AgentStatus;
}

// --- PR3 additions: tool CRUD ---

export interface CreateToolInput {
  config_id: string;
  name: string;
  description: string;
  input_schema: JSONSchemaObject;
  execution_mode: ToolExecutionMode;
  native_handler?: NativeHandlerName;
  webhook_url?: string;
  webhook_secret?: string;
  mcp_server_id?: string;
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
  mcp_server_id?: string | null;
  is_enabled?: boolean;
}

// Convenience DTO for creating a tool backed by an MCP server tool.
// The tool name must match exactly the tool name exposed by the server
// (as returned by tools/list). Description and input_schema can be sourced
// from cached_tools for convenience, but the runtime re-validates at call time.
export interface CreateMcpToolInput {
  config_id: string;
  mcp_server_id: string;
  name: string;               // must match tool name on MCP server
  description: string;
  input_schema: JSONSchemaObject;
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
  //
  // OpenAI Responses strict-ready (mai/2026, pós PR #379-#380): cada
  // variant aceita `nullable?: boolean`. Quando `nullable: true`, o
  // adapter em `apps/crm/src/lib/ai-agent/flow/openai-runtime.ts` converte
  // pro formato JSON Schema 2020-12 `type: ["<original>", "null"]` ao
  // mandar pra Responses API (que exige tipos explícitos pra accept null).
  // Chat Completions tolera o campo `nullable` (ignora) sem quebra.
  | { type: "string"; description?: string; enum?: readonly string[]; format?: "uuid" | "email" | "uri" | "date-time"; nullable?: boolean }
  | { type: "number"; description?: string; minimum?: number; maximum?: number; nullable?: boolean }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number; nullable?: boolean }
  | { type: "boolean"; description?: string; nullable?: boolean }
  | { type: "array"; description?: string; items: JSONSchemaProperty; nullable?: boolean }
  | { type: "object"; description?: string; properties?: Record<string, JSONSchemaProperty>; required?: string[]; additionalProperties?: boolean; nullable?: boolean };
