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
  AgentKnowledgeSource,
  AgentNotificationTemplate,
  AgentRunWithSteps,
  AgentScheduledJob,
  AgentStage,
  AgentStageTool,
  AgentTool,
  CreateAgentInput,
  CreateCustomWebhookToolInput,
  CreateFAQInput,
  CreateNotificationTemplateInput,
  CreateScheduledJobInput,
  CreateStageInput,
  CreateToolFromPresetInput,
  ListRunsInput,
  ReorderStagesInput,
  SetCostLimitInput,
  SetStageToolInput,
  TesterRequest,
  TesterResponse,
  UpdateAgentInput,
  UpdateFAQInput,
  UpdateNotificationTemplateInput,
  UpdateScheduledJobInput,
  UpdateStageInput,
  UpdateToolInput,
  UsageStats,
  UsageStatsInput,
} from "@persia/shared/ai-agent";

export interface AgentActions {
  // Configs
  createAgent: (input: CreateAgentInput) => Promise<AgentConfig>;
  updateAgent: (configId: string, input: UpdateAgentInput) => Promise<AgentConfig>;
  deleteAgent: (configId: string) => Promise<void>;

  // Stages
  createStage: (configId: string, input: CreateStageInput) => Promise<AgentStage>;
  updateStage: (stageId: string, input: UpdateStageInput) => Promise<AgentStage>;
  deleteStage: (stageId: string) => Promise<void>;
  reorderStages: (input: ReorderStagesInput) => Promise<void>;

  // Tools
  createToolFromPreset: (input: CreateToolFromPresetInput) => Promise<AgentTool>;
  createCustomWebhookTool: (input: CreateCustomWebhookToolInput) => Promise<AgentTool>;
  updateTool: (toolId: string, input: UpdateToolInput) => Promise<AgentTool>;
  deleteTool: (toolId: string) => Promise<void>;
  setStageTool: (input: SetStageToolInput) => Promise<AgentStageTool>;
  listStageTools: (stageId: string) => Promise<AgentStageTool[]>;

  // Webhook allowlist
  addAllowedDomain: (input: AddAllowedDomainInput) => Promise<string[]>;
  removeAllowedDomain: (domain: string) => Promise<string[]>;

  // Feature flag
  setNativeAgentEnabled: (enabled: boolean) => Promise<boolean>;

  // Tester
  testAgent: (req: TesterRequest) => Promise<TesterResponse>;

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
}
