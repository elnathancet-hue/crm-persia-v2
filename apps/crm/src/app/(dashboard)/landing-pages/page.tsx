import { PageTitle } from "@persia/ui/typography";
import { getLandingPages } from "@/actions/landing-pages";
import { LandingPagesClient } from "./landing-pages-client";

export default async function LandingPagesPage() {
  const pages = await getLandingPages();

  return (
    <div className="space-y-6">
      <div>
        <PageTitle size="compact">Landing Pages</PageTitle>
        <p className="text-sm text-muted-foreground">
          Crie páginas de captura para converter visitantes em leads
        </p>
      </div>
      <LandingPagesClient initialPages={(pages || []) as never} />
    </div>
  );
}
