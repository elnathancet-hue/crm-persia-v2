import { notFound } from "next/navigation";
import {
  getCampaignEvents,
  getCampaignRecipients,
  getCrmCampaignDetails,
} from "@/actions/crm-campaigns";
import { CrmCampaignCockpit } from "@/components/campaigns/crm-campaign-cockpit";

export default async function CampaignDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const campaign = await getCrmCampaignDetails(id);
  if (!campaign) notFound();

  const [recipients, events] = await Promise.all([
    getCampaignRecipients(id),
    getCampaignEvents(id).catch(() => []),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <CrmCampaignCockpit campaign={campaign} recipients={recipients} events={events} />
    </div>
  );
}
