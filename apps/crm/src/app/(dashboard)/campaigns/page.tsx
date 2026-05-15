import { PageTitle } from "@persia/ui/typography";
import { getCampaigns } from "@/actions/campaigns";
import { CampaignList } from "@/components/campaigns/campaign-list";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";

export default async function CampaignsPage() {
  await requireAdminPageAccess();
  const campaigns = await getCampaigns();

  return (
    <div className="space-y-6">
      <PageTitle size="compact">Campanhas WhatsApp</PageTitle>
      <CampaignList campaigns={(campaigns || []) as never} />
    </div>
  );
}
