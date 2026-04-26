import { notFound } from "next/navigation";
import { getAgent } from "@/actions/ai-agent/configs";
import { listStages } from "@/actions/ai-agent/stages";
import { listToolsForAgent } from "@/actions/ai-agent/tools";
import { listCostLimits } from "@/actions/ai-agent/limits";
import { listAllowedDomains } from "@/actions/ai-agent/webhook-allowlist";
import { listKnowledgeSources } from "@/actions/ai-agent/knowledge";
import { listNotificationTemplates } from "@/actions/ai-agent/notifications";
import { listScheduledJobs } from "@/actions/ai-agent/scheduled-jobs";
import { listFollowups } from "@/actions/ai-agent/followups";
import { AgentEditorClient } from "./agent-editor-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const [
    stages,
    tools,
    limits,
    allowedDomains,
    knowledgeSources,
    notificationTemplates,
    scheduledJobs,
    followups,
  ] = await Promise.all([
    listStages(id),
    listToolsForAgent(id),
    listCostLimits(),
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
      initialLimits={limits}
      initialAllowedDomains={allowedDomains}
      initialKnowledgeSources={knowledgeSources}
      initialNotificationTemplates={notificationTemplates}
      initialScheduledJobs={scheduledJobs}
      initialFollowups={followups}
    />
  );
}
