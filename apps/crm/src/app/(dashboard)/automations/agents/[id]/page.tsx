import { notFound } from "next/navigation";
import { getAgent } from "@/actions/ai-agent/configs";
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

// PR-FLOW-PIVOT (mai/2026): listStages removido — flow vive em agent_flows.
// UI canvas (PR 3) carrega flow via novo loader. Por enquanto a aba Fluxo
// aparece vazia.
export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const [
    tools,
    allowedDomains,
    knowledgeSources,
    notificationTemplates,
    scheduledJobs,
    followups,
  ] = await Promise.all([
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
      initialStages={[]}
      initialTools={tools}
      initialAllowedDomains={allowedDomains}
      initialKnowledgeSources={knowledgeSources}
      initialNotificationTemplates={notificationTemplates}
      initialScheduledJobs={scheduledJobs}
      initialFollowups={followups}
    />
  );
}
