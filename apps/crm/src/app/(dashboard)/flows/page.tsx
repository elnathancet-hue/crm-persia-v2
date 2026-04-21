import { getFlows } from "@/actions/flows";
import { FlowsPageClient } from "./flows-client";

export default async function FlowsPage() {
  const flows = await getFlows();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-heading">Fluxos de Automação</h1>
        <p className="text-sm text-muted-foreground">
          Crie fluxos para automatizar ações com seus leads
        </p>
      </div>
      <FlowsPageClient initialFlows={flows || []} />
    </div>
  );
}
