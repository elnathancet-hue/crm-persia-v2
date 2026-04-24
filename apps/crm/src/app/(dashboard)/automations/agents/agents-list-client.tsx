"use client";

import type { AgentConfig } from "@persia/shared/ai-agent";
import { AgentActionsProvider, AgentsList } from "@persia/ai-agent-ui";
import { crmAgentActions } from "@/features/ai-agent/crm-actions";

interface Props {
  initialAgents: AgentConfig[];
  nativeEnabled: boolean;
}

export function AgentsListClient(props: Props) {
  return (
    <AgentActionsProvider actions={crmAgentActions}>
      <AgentsList {...props} />
    </AgentActionsProvider>
  );
}
