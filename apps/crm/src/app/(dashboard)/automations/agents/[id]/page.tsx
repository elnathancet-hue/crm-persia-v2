import { notFound } from "next/navigation";
import { getAgent } from "@/actions/ai-agent/configs";
import { listStages } from "@/actions/ai-agent/stages";
import { listToolsForAgent } from "@/actions/ai-agent/tools";
import { listAllowedDomains } from "@/actions/ai-agent/webhook-allowlist";
import { listKnowledgeSources } from "@/actions/ai-agent/knowledge";
import { listNotificationTemplates } from "@/actions/ai-agent/notifications";
import { listScheduledJobs } from "@/actions/ai-agent/scheduled-jobs";
import { listFollowups } from "@/actions/ai-agent/followups";
import { AgentEditorClient } from "./agent-editor-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

// PR-AI-AGENT-TOKENS-OUT (mai/2026): listCostLimits removido do hydrate.
// Cliente nao ve mais aba "Limites e Uso" — token/cost e responsabilidade
// do CRM Persia (plano fixo). Backend continua respeitando limits via
// guardrails se configurados por admin.
export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const [
    stages,
    tools,
    allowedDomains,
    knowledgeSources,
    notificationTemplates,
    scheduledJobs,
    followups,
  ] = await Promise.all([
    listStages(id),
    listToolsForAgent(id),
    listAllowedDomains(),
    listKnowledgeSources(id),
    listNotificationTemplates(id),
    listScheduledJobs(id),
    listFollowups(id),
  ]);

  return (
    <AgentEditorClient
      initialAgent={agent}
      initialStages={stages}
      initialTools={tools}
      initialAllowedDomains={allowedDomains}
      initialKnowledgeSources={knowledgeSources}
      initialNotificationTemplates={notificationTemplates}
      initialScheduledJobs={scheduledJobs}
      initialFollowups={followups}
    />
  );
}
