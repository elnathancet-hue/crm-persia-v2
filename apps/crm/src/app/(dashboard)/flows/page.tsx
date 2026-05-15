import { PageTitle } from "@persia/ui/typography";
import { getFlows } from "@/actions/flows";
import { FlowsPageClient } from "./flows-client";

export default async function FlowsPage() {
  const flows = await getFlows();

  return (
    <div className="space-y-6">
      <div>
        <PageTitle size="compact">Fluxos de Automação</PageTitle>
        <p className="text-sm text-muted-foreground">
          Crie fluxos para automatizar ações com seus leads
        </p>
      </div>
      <FlowsPageClient initialFlows={flows || []} />
    </div>
  );
}
