import { notFound } from "next/navigation";
import { getAgent } from "@/actions/ai-agent/configs";
import { listStages } from "@/actions/ai-agent/stages";
import { listToolsForAgent } from "@/actions/ai-agent/tools";
import { listCostLimits } from "@/actions/ai-agent/limits";
import { AgentEditorClient } from "./agent-editor-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const [stages, tools, limits] = await Promise.all([
    listStages(id),
    listToolsForAgent(id),
    listCostLimits(),
  ]);

  return (
    <AgentEditorClient
      initialAgent={agent}
      initialStages={stages}
      initialTools={tools}
      initialLimits={limits}
    />
  );
}
