import { notFound } from "next/navigation";
import { getAgent } from "@/actions/ai-agent/configs";
import { listStages } from "@/actions/ai-agent/stages";
import { AgentEditorClient } from "./agent-editor-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();

  const stages = await listStages(id);

  return <AgentEditorClient initialAgent={agent} initialStages={stages} />;
}
