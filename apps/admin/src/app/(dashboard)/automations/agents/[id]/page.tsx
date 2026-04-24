import { AgentEditorClient } from "./agent-editor-client";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentEditorClient agentId={id} />;
}
