"use client";

import type { AgentActions } from "@persia/ai-agent-ui";
import { createAgent, deleteAgent, setPrimaryAgent, updateAgent } from "@/actions/ai-agent/configs";
import {
  createEntryCondition,
  deleteEntryCondition,
  listEntryConditions,
  updateEntryCondition,
} from "@/actions/ai-agent/entry-conditions";
// PR-FLOW-PIVOT (mai/2026): stages CRUD + setStageTool removidos. Allowlist
// de tools migra pra agent_flows.enabled_tools.
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
import {
  createFollowup,
  deleteFollowup,
  listFollowups,
  toggleFollowup,
  updateFollowup,
} from "@/actions/ai-agent/followups";

export function createAdminAgentActions(orgId: string): AgentActions {
  return {
    createAgent: (input) => createAgent(orgId, input),
    updateAgent: (configId, input) => updateAgent(orgId, configId, input),
    deleteAgent: (configId) => deleteAgent(orgId, configId),
    setPrimaryAgent: (configId) => setPrimaryAgent(orgId, configId),
    listEntryConditions: (configId) => listEntryConditions(orgId, configId),
    createEntryCondition: (input) => createEntryCondition(orgId, input),
    updateEntryCondition: (id, input) => updateEntryCondition(orgId, id, input),
    deleteEntryCondition: (id) => deleteEntryCondition(orgId, id),
    createToolFromPreset: (input) => createToolFromPreset(orgId, input),
    createCustomWebhookTool: (input) => createCustomWebhookTool(orgId, input),
    updateTool: (toolId, input) => updateTool(orgId, toolId, input),
    deleteTool: (toolId) => deleteTool(orgId, toolId),
    setNativeToolEnabled: (input) => setNativeToolEnabled(orgId, input),
    addAllowedDomain: (input) => addAllowedDomain(orgId, input),
    removeAllowedDomain: (domain) => removeAllowedDomain(orgId, domain),
    setNativeAgentEnabled: (enabled) => setNativeAgentEnabled(orgId, enabled),
    testAgent: (req) => testAgent(orgId, req),
    listRuns: (input) => listRuns(orgId, input),
    setCostLimit: (input) => setCostLimit(orgId, input),
    deleteCostLimit: (id) => deleteCostLimit(orgId, id),
    getUsageStats: (input) => getUsageStats(orgId, input),
    listKnowledgeSources: (configId) => listKnowledgeSources(orgId, configId),
    createFAQ: (input) => createFAQ(orgId, input),
    updateFAQ: (sourceId, input) => updateFAQ(orgId, sourceId, input),
    uploadDocument: (configId, formData) => uploadDocument(orgId, configId, formData),
    deleteKnowledgeSource: (sourceId) => deleteKnowledgeSource(orgId, sourceId),
    reindexKnowledgeSource: (sourceId) => reindexKnowledgeSource(orgId, sourceId),
    listNotificationTemplates: (configId) =>
      listNotificationTemplates(orgId, configId),
    createNotificationTemplate: (input) =>
      createNotificationTemplate(orgId, input),
    updateNotificationTemplate: (sourceId, input) =>
      updateNotificationTemplate(orgId, sourceId, input),
    deleteNotificationTemplate: (sourceId) =>
      deleteNotificationTemplate(orgId, sourceId),
    listScheduledJobs: (configId) => listScheduledJobs(orgId, configId),
    createScheduledJob: (input) => createScheduledJob(orgId, input),
    updateScheduledJob: (jobId, input) =>
      updateScheduledJob(orgId, jobId, input),
    deleteScheduledJob: (jobId) => deleteScheduledJob(orgId, jobId),
    listCalendarConnections: () => listCalendarConnections(orgId),
    deleteCalendarConnection: (connectionId) =>
      deleteCalendarConnection(orgId, connectionId),
    buildOAuthStartUrl: (returnTo) => buildOAuthStartUrl(orgId, returnTo),
    listFollowups: (configId) => listFollowups(orgId, configId),
    createFollowup: (input) => createFollowup(orgId, input),
    updateFollowup: (followupId, input) =>
      updateFollowup(orgId, followupId, input),
    deleteFollowup: (followupId) => deleteFollowup(orgId, followupId),
    toggleFollowup: (followupId, isEnabled) =>
      toggleFollowup(orgId, followupId, isEnabled),
  };
}
