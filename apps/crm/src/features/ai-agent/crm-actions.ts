// CRM-side AgentActions wiring.
//
// Server actions ja resolvem orgId via cookie da sessao (requireRole). O
// wrapper so mapeia 1-pra-1 no formato esperado pelo @persia/ai-agent-ui.
// O admin faz o equivalente em apps/admin com requireSuperadminForOrg.

import type { AgentActions } from "@persia/ai-agent-ui";
import { createAgent, deleteAgent, updateAgent } from "@/actions/ai-agent/configs";
import {
  createStage,
  deleteStage,
  reorderStages,
  updateStage,
} from "@/actions/ai-agent/stages";
import {
  createCustomWebhookTool,
  createToolFromPreset,
  deleteTool,
  listStageTools,
  setStageTool,
  updateTool,
} from "@/actions/ai-agent/tools";
import {
  addAllowedDomain,
  removeAllowedDomain,
} from "@/actions/ai-agent/webhook-allowlist";
import { setNativeAgentEnabled } from "@/actions/ai-agent/feature-flag";
import { testAgent } from "@/actions/ai-agent/tester";
import { listRuns } from "@/actions/ai-agent/audit";
import { deleteCostLimit, setCostLimit } from "@/actions/ai-agent/limits";
import { getUsageStats } from "@/actions/ai-agent/usage";
import {
  createFAQ,
  deleteKnowledgeSource,
  listKnowledgeSources,
  reindexKnowledgeSource,
  updateFAQ,
  uploadDocument,
} from "@/actions/ai-agent/knowledge";
import {
  createNotificationTemplate,
  deleteNotificationTemplate,
  listNotificationTemplates,
  updateNotificationTemplate,
} from "@/actions/ai-agent/notifications";

export const crmAgentActions: AgentActions = {
  createAgent,
  updateAgent,
  deleteAgent,
  createStage,
  updateStage,
  deleteStage,
  reorderStages,
  createToolFromPreset,
  createCustomWebhookTool,
  updateTool,
  deleteTool,
  setStageTool,
  listStageTools,
  addAllowedDomain,
  removeAllowedDomain,
  setNativeAgentEnabled,
  testAgent,
  listRuns,
  setCostLimit,
  deleteCostLimit,
  getUsageStats,
  listKnowledgeSources,
  createFAQ,
  updateFAQ,
  uploadDocument,
  deleteKnowledgeSource,
  reindexKnowledgeSource,
  listNotificationTemplates,
  createNotificationTemplate,
  updateNotificationTemplate,
  deleteNotificationTemplate,
};
