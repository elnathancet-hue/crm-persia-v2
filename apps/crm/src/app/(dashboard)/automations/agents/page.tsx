import { listAgents } from "@/actions/ai-agent/configs";
import { isNativeAgentEnabled } from "@/actions/ai-agent/feature-flag";
import { AgentsListClient } from "./agents-list-client";

export const metadata = { title: "Agente IA" };

// PR-AI-AGENT-VISUAL (mai/2026): header + tabs movidos pro client
// (paridade com /crm — icone grande no header + sticky). Page server
// apenas hidrata dados iniciais. Mesmo pattern do /agenda PR #217.
export default async function AgentsPage() {
  const [agents, enabled] = await Promise.all([
    listAgents(),
    isNativeAgentEnabled(),
  ]);

  return <AgentsListClient initialAgents={agents} nativeEnabled={enabled} />;
}
