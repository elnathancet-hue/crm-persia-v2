"use client";

import type {
  AgentConfig,
  AgentFollowup,
  AgentKnowledgeSource,
  AgentNotificationTemplate,
  AgentScheduledJob,
  AgentTool,
} from "@persia/shared/ai-agent";
import { AgentActionsProvider, AgentEditor } from "@persia/ai-agent-ui";
import { crmAgentActions } from "@/features/ai-agent/crm-actions";

interface Props {
  initialAgent: AgentConfig;
  // PR-FLOW-PIVOT (mai/2026): initialStages mantido como `unknown[]` pra
  // não quebrar contrato do AgentEditor durante a transição. Aba "Fluxo"
  // do canvas (PR 3) ignora esse prop e busca de agent_flows.
  initialStages: unknown[];
  initialTools: AgentTool[];
  initialAllowedDomains: string[];
  initialKnowledgeSources?: AgentKnowledgeSource[];
  initialNotificationTemplates?: AgentNotificationTemplate[];
  initialScheduledJobs?: AgentScheduledJob[];
  initialFollowups?: AgentFollowup[];
}

export function AgentEditorClient(props: Props) {
  return (
    <AgentActionsProvider actions={crmAgentActions}>
      <AgentEditor {...props} />
    </AgentActionsProvider>
  );
}
