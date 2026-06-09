// CRM-side AgentActions wiring.
//
// Server actions ja resolvem orgId via cookie da sessao (requireRole). O
// wrapper so mapeia 1-pra-1 no formato esperado pelo @persia/ai-agent-ui.
// O admin faz o equivalente em apps/admin com requireSuperadminForOrg.

import type { AgentActions } from "@persia/ai-agent-ui";
import { createAgent, deleteAgent, setPrimaryAgent, updateAgent } from "@/actions/ai-agent/configs";
import { getFlow, previewFlowImpact, saveFlow } from "@/actions/ai-agent/flow";
import { getFlowCatalogs } from "@/actions/ai-agent/flow-catalogs";
// PR-FLOW-PIVOT (mai/2026): stages + stage-action-config + setStageTool
// removidos. Allowlist de tools migra pra agent_flows.enabled_tools.
import {
  createCustomWebhookTool,
  createToolFromPreset,
  deleteTool,
  setNativeToolEnabled,
  updateTool,
} from "@/actions/ai-agent/tools";
import {
  addAllowedDomain,
  removeAllowedDomain,
} from "@/actions/ai-agent/webhook-allowlist";
import { setNativeAgentEnabled } from "@/actions/ai-agent/feature-flag";
import {
  createEntryCondition,
  deleteEntryCondition,
  listEntryConditions,
  updateEntryCondition,
} from "@/actions/ai-agent/entry-conditions";
import {
  resetTesterConversation,
  simulateCrmEvent,
  testAgent,
  testAgentLive,
} from "@/actions/ai-agent/tester";
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
import {
  createScheduledJob,
  deleteScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
} from "@/actions/ai-agent/scheduled-jobs";
import {
  buildOAuthStartUrl,
  deleteCalendarConnection,
  listCalendarConnections,
} from "@/actions/ai-agent/calendar";
import { listMcpServers } from "@/actions/mcp-servers";
import {
  createFollowup,
  deleteFollowup,
  listFollowups,
  toggleFollowup,
  updateFollowup,
} from "@/actions/ai-agent/followups";

export const crmAgentActions: AgentActions = {
  createAgent,
  updateAgent,
  deleteAgent,
  setPrimaryAgent,
  listEntryConditions,
  createEntryCondition,
  updateEntryCondition,
  deleteEntryCondition,
  getFlow,
  saveFlow,
  previewFlowImpact,
  getFlowCatalogs,
  createToolFromPreset,
  createCustomWebhookTool,
  updateTool,
  deleteTool,
  setNativeToolEnabled,
  addAllowedDomain,
  removeAllowedDomain,
  setNativeAgentEnabled,
  testAgent,
  testAgentLive,
  resetTesterConversation,
  simulateCrmEvent,
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
  listScheduledJobs,
  createScheduledJob,
  updateScheduledJob,
  deleteScheduledJob,
  listMcpServers,
  listCalendarConnections,
  deleteCalendarConnection,
  buildOAuthStartUrl,
  listFollowups,
  createFollowup,
  updateFollowup,
  deleteFollowup,
  toggleFollowup,
};
