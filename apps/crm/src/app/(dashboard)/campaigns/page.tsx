import { getCampaigns } from "@/actions/campaigns";
import { CampaignList } from "@/components/campaigns/campaign-list";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";

export default async function CampaignsPage() {
  await requireAdminPageAccess();
  const campaigns = await getCampaigns();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight font-heading">Campanhas WhatsApp</h1>
      <CampaignList campaigns={(campaigns || []) as never} />
    </div>
  );
}
