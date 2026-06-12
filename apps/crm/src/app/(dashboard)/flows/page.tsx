import { PageTitle } from "@persia/ui/typography";
import { getFlows } from "@/actions/flows";
import { FlowsPageClient } from "./flows-client";
import { LegacyBanner } from "@/components/legacy-banner";

export const metadata = { title: "Fluxos" };

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
      <LegacyBanner featureName="Fluxos de Automação" />
      <FlowsPageClient initialFlows={flows || []} />
    </div>
  );
}
