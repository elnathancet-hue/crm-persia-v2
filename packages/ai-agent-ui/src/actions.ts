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
   * dica de "arraste a primeira tarefa". */
  getFlow: (configId: string) => Promise<FlowConfig | null>;
  /** Persiste o flow inteiro (nodes + edges + viewport + enabled_tools).
   * Retorna a nova version pra UI atualizar state local. Server normaliza
   * antes de salvar via normalizeFlowConfig. */
  saveFlow: (
    configId: string,
    config: FlowConfig,
  ) => Promise<{ ok: true; version: number }>;

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
