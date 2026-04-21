import { getFlow } from "@/actions/flows";
import { FlowEditorClient } from "./flow-editor-client";
import { notFound } from "next/navigation";

export default async function FlowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let flow;
  try {
    flow = await getFlow(id);
  } catch {
    notFound();
  }

  if (!flow) notFound();

  return <FlowEditorClient flow={flow as never} />;
}
