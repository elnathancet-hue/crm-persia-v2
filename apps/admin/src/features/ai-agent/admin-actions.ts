"use client";

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

export function createAdminAgentActions(orgId: string): AgentActions {
  return {
    createAgent: (input) => createAgent(orgId, input),
    updateAgent: (configId, input) => updateAgent(orgId, configId, input),
    deleteAgent: (configId) => deleteAgent(orgId, configId),
    createStage: (configId, input) => createStage(orgId, configId, input),
    updateStage: (stageId, input) => updateStage(orgId, stageId, input),
    deleteStage: (stageId) => deleteStage(orgId, stageId),
    reorderStages: (input) => reorderStages(orgId, input),
    createToolFromPreset: (input) => createToolFromPreset(orgId, input),
    createCustomWebhookTool: (input) => createCustomWebhookTool(orgId, input),
    updateTool: (toolId, input) => updateTool(orgId, toolId, input),
    deleteTool: (toolId) => deleteTool(orgId, toolId),
    setStageTool: (input) => setStageTool(orgId, input),
    listStageTools: (stageId) => listStageTools(orgId, stageId),
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
  };
}
