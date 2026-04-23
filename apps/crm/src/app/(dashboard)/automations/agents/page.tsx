import { listAgents } from "@/actions/ai-agent/configs";
import { isNativeAgentEnabled } from "@/actions/ai-agent/feature-flag";
import { AgentsListClient } from "./agents-list-client";

export const metadata = { title: "Agente IA Nativo" };

export default async function AgentsPage() {
  const [agents, enabled] = await Promise.all([
    listAgents(),
    isNativeAgentEnabled(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agente IA Nativo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure etapas, regras e ferramentas para o agente responder suas conversas sem webhooks externos
        </p>
      </div>
      <AgentsListClient initialAgents={agents} nativeEnabled={enabled} />
    </div>
  );
}
