"use client";

import type {
  AgentConfig,
  AgentCostLimit,
  AgentKnowledgeSource,
  AgentNotificationTemplate,
  AgentScheduledJob,
  AgentStage,
  AgentTool,
} from "@persia/shared/ai-agent";
import { AgentActionsProvider, AgentEditor } from "@persia/ai-agent-ui";
import { crmAgentActions } from "@/features/ai-agent/crm-actions";

interface Props {
  initialAgent: AgentConfig;
  initialStages: AgentStage[];
  initialTools: AgentTool[];
  initialLimits: AgentCostLimit[];
  initialAllowedDomains: string[];
  initialKnowledgeSources?: AgentKnowledgeSource[];
  initialNotificationTemplates?: AgentNotificationTemplate[];
  initialScheduledJobs?: AgentScheduledJob[];
}

export function AgentEditorClient(props: Props) {
  return (
    <AgentActionsProvider actions={crmAgentActions}>
      <AgentEditor {...props} />
    </AgentActionsProvider>
  );
}
