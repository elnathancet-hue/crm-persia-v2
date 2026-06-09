// Dependency injection for AI Agent UI.
//
// Both apps (crm, admin) construct a concrete AgentActions object pointing
// to their own server actions and pass it into <AgentActionsProvider>. The
// shared components never import `@/actions/*` directly — they pull the
// bag through `useAgentActions()`.
//
// Signatures match the CRM action signatures (orgId-less). Admin wraps
// its actions to curry the selected orgId in before exposing them.

import type {
  AddAllowedDomainInput,
  AgentConfig,
  AgentCostLimit,
  AgentFollowup,
  AgentKnowledgeSource,
  AgentCalendarConnectionPublic,
  AgentNotificationTemplate,
  AgentRunWithSteps,
  AgentScheduledJob,
  AgentTool,
  CreateAgentInput,
  CreateCustomWebhookToolInput,
  CreateFAQInput,
  CreateFollowupInput,
  CreateNotificationTemplateInput,
  CreateScheduledJobInput,
  AgentEntryCondition,
  CreateEntryConditionInput,
  CreateToolFromPresetInput,
  FlowConfig,
  ListRunsInput,
  NativeHandlerName,
  UpdateEntryConditionInput,
  SetCostLimitInput,
  TesterRequest,
  TesterResponse,
  UpdateAgentInput,
  UpdateFAQInput,
  UpdateFollowupInput,
  UpdateNotificationTemplateInput,
  UpdateScheduledJobInput,
  UpdateToolInput,
  UsageStats,
  UsageStatsInput,
} from "@persia/shared/ai-agent";

export interface AgentActions {
  // Configs
  createAgent: (input: CreateAgentInput) => Promise<AgentConfig>;
  updateAgent: (configId: string, input: UpdateAgentInput) => Promise<AgentConfig>;
  deleteAgent: (configId: string) => Promise<void>;
  // PR-AGENT-INTEGRATION-3: roteamento multi-agente.
  setPrimaryAgent: (configId: string) => Promise<AgentConfig>;
  listEntryConditions: (configId: string) => Promise<AgentEntryCondition[]>;
  createEntryCondition: (input: CreateEntryConditionInput) => Promise<AgentEntryCondition>;
  updateEntryCondition: (
    conditionId: string,
    input: UpdateEntryConditionInput,
  ) => Promise<AgentEntryCondition>;
  deleteEntryCondition: (conditionId: string) => Promise<void>;

  // Flow canvas — PR-FLOW-PIVOT PR 3 (mai/2026). Substituiu o CRUD de
  // stages: agora o agente tem 1 flow JSONB com nodes/edges visuais.
  /** Carrega o flow_config do agente. Null = agente sem flow (criado
   * via API sem template). Canvas deve renderizar estado vazio com
   * dica de "arraste a primeira tarefa".
   *
   * Backlog #3 Auditoria (mai/2026): retorna tambem a `version` corrente
   * pra UI passar como `expectedVersion` no saveFlow (CAS optimistic
   * locking). */
  getFlow: (
    configId: string,
  ) => Promise<{ config: FlowConfig; version: number } | null>;
  /** Persiste o flow inteiro (nodes + edges + viewport + enabled_tools).
   * Retorna a nova version pra UI atualizar state local. Server normaliza
   * antes de salvar via normalizeFlowConfig.
   *
   * Backlog #3 Auditoria (mai/2026): CAS optimistic locking. UI passa
   * `expectedVersion` (versao carregada no momento do load do canvas).
   * Se outro admin salvou primeiro (versao no DB e diferente), retorno
   * `{ ok: false, conflict: true, current_version }`. UI decide:
   * mostrar modal "recarregue antes de salvar" OU oferecer overwrite.
   *
   * Backwards-compat: chamadas sem `expectedVersion` mantem comportamento
   * antigo (last-write-wins). Caller novo passa pra ativar CAS. */
  saveFlow: (
    configId: string,
    config: FlowConfig,
    expectedVersion?: number,
  ) => Promise<
    | { ok: true; version: number }
    | {
        ok: false;
        conflict: true;
        expected_version: number;
        current_version: number;
      }
  >;
  /** Backlog #4 Auditoria (mai/2026): preview de impacto antes do save.
   * Retorna quantas conversas vivas tem current_node_id apontando pra
   * nodes que sumiriam no save proposto. UI usa pra modal de confirmacao.
   *
   * Read-only — pode ser chamada sempre que o flow muda no canvas sem
   * efeito colateral. */
  previewFlowImpact: (
    configId: string,
    config: FlowConfig,
  ) => Promise<{
    affected_conversations: number;
    at_risk_node_ids: string[];
    total_live_conversations: number;
  }>;
  /** Carrega catálogos pros pickers do NodeConfigSheet (tags, stages,
   * templates, agenda, membros, outros agentes). Single roundtrip. */
  getFlowCatalogs: (
    configId: string,
  ) => Promise<import("./components/flow/catalog-types").FlowCatalogs>;

  // Tools
  createToolFromPreset: (input: CreateToolFromPresetInput) => Promise<AgentTool>;
  createCustomWebhookTool: (input: CreateCustomWebhookToolInput) => Promise<AgentTool>;
  updateTool: (toolId: string, input: UpdateToolInput) => Promise<AgentTool>;
  deleteTool: (toolId: string) => Promise<void>;
  // PR-FLOW-PIVOT: setStageTool/listStageTools removidos — allowlist de
  // tools vive em agent_flows.enabled_tools (allowlist global por flow).
  // PR-AGENT-INTEGRATION-2: toggle nativo por handler (cria ou atualiza
  // is_enabled). Idempotente, preserva config quando desliga.
  setNativeToolEnabled: (input: {
    config_id: string;
    handler: NativeHandlerName;
    enabled: boolean;
  }) => Promise<AgentTool>;

  // Webhook allowlist
  addAllowedDomain: (input: AddAllowedDomainInput) => Promise<string[]>;
  removeAllowedDomain: (domain: string) => Promise<string[]>;

  // Feature flag
  setNativeAgentEnabled: (enabled: boolean) => Promise<boolean>;

  // Tester
  testAgent: (req: TesterRequest) => Promise<TesterResponse>;
  /** PR-AI-AGENT-TESTER-FAITHFUL (mai/2026): tester que reproduz o
   * pipeline completo (pause/resume, business hours, debounce, split,
   * delay, typing). Opcional pra retrocompat — se o app nao injetar,
   * UI cai pro testAgent legado sem reproducao fiel. */
  testAgentLive?: (
    req: import("@persia/shared/ai-agent").TesterLiveRequest,
  ) => Promise<import("@persia/shared/ai-agent").TesterLiveResponse>;
  /** Apaga state da conversa Tester (msgs, runs, agent_conversation).
   * Usado pelo botao Resetar no TesterSheet pra recomecar do zero. */
  resetTesterConversation?: () => Promise<{ ok: true }>;
  /** PR-FLOW-PIVOT PR 16 (mai/2026): simula evento CRM no Tester
   * (lead entrou em stage/segment) — roda flow do entry node com
   * inbound vazio. Opcional — UI esconde botão se não injetado. */
  simulateCrmEvent?: (
    req: import("@persia/shared/ai-agent").TesterSimulateEventRequest,
  ) => Promise<import("@persia/shared/ai-agent").TesterLiveResponse>;

  // PR-FLOW-PIVOT (mai/2026): getStageActionCatalogs + updateStageActionConfig
  // removidos. Catálogos viram parte do FlowEditor (PR 3) que vai injetar
  // tags/templates/medias via novo método getFlowCatalogs?(configId).

  // Audit
  listRuns: (input: ListRunsInput) => Promise<AgentRunWithSteps[]>;

  // Limits
  setCostLimit: (input: SetCostLimitInput) => Promise<AgentCostLimit>;
  deleteCostLimit: (id: string) => Promise<void>;

  // Usage
  getUsageStats: (input: UsageStatsInput) => Promise<UsageStats>;

  // Knowledge base (PR6 RAG)
  listKnowledgeSources: (configId: string) => Promise<AgentKnowledgeSource[]>;
  createFAQ: (input: CreateFAQInput) => Promise<AgentKnowledgeSource>;
  updateFAQ: (sourceId: string, input: UpdateFAQInput) => Promise<AgentKnowledgeSource>;
  uploadDocument: (configId: string, formData: FormData) => Promise<AgentKnowledgeSource>;
  deleteKnowledgeSource: (sourceId: string) => Promise<void>;
  reindexKnowledgeSource: (sourceId: string) => Promise<AgentKnowledgeSource>;

  // Notification templates (PR7.1)
  listNotificationTemplates: (configId: string) => Promise<AgentNotificationTemplate[]>;
  createNotificationTemplate: (
    input: CreateNotificationTemplateInput,
  ) => Promise<AgentNotificationTemplate>;
  updateNotificationTemplate: (
    sourceId: string,
    input: UpdateNotificationTemplateInput,
  ) => Promise<AgentNotificationTemplate>;
  deleteNotificationTemplate: (sourceId: string) => Promise<void>;

  // Scheduled jobs (PR7.2)
  listScheduledJobs: (configId: string) => Promise<AgentScheduledJob[]>;
  createScheduledJob: (
    input: CreateScheduledJobInput,
  ) => Promise<AgentScheduledJob>;
  updateScheduledJob: (
    jobId: string,
    input: UpdateScheduledJobInput,
  ) => Promise<AgentScheduledJob>;
  deleteScheduledJob: (jobId: string) => Promise<void>;

  // MCP servers — subset público (sem auth_token) pra pickers de fontes estruturadas.
  // Opcional: admin pode não implementar (UI desabilita tipo MCP quando ausente).
  listMcpServers?: () => Promise<{
    ok: true;
    servers: Array<{
      id: string;
      name: string;
      server_url: string;
      is_active: boolean;
      cached_tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
    }>;
  } | { ok: false; error: string }>;

  // Calendar connections (PR7.3)
  listCalendarConnections: () => Promise<AgentCalendarConnectionPublic[]>;
  deleteCalendarConnection: (connectionId: string) => Promise<void>;
  buildOAuthStartUrl: (returnTo: string) => Promise<{ url: string }>;

  // Follow-ups (PR #62) — runtime tick pendente, UI/CRUD ja prontos.
  listFollowups: (configId: string) => Promise<AgentFollowup[]>;
  createFollowup: (input: CreateFollowupInput) => Promise<AgentFollowup>;
  updateFollowup: (
    followupId: string,
    input: UpdateFollowupInput,
  ) => Promise<AgentFollowup>;
  deleteFollowup: (followupId: string) => Promise<void>;
  toggleFollowup: (followupId: string, isEnabled: boolean) => Promise<AgentFollowup>;
}
