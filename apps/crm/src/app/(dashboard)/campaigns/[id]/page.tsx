import React from "react";
import { notFound } from "next/navigation";
import { requireAdminPageAccess } from "@/lib/guards/require-admin";
import { getCrmCampaignDetails, getCampaignRecipients, getCampaignEvents } from "@/actions/crm-campaigns";
import { CrmCampaignCockpit } from "@/components/campaigns/crm-campaign-cockpit";

export default async function CampaignDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPageAccess();
  const { id } = await params;

  // Fetch Campaign Details
  const campaign = await getCrmCampaignDetails(id);
  if (!campaign) notFound();

  // Fetch parallel lists
  const [recipients, events] = await Promise.all([
    getCampaignRecipients(id),
    getCampaignEvents(id).catch(() => []),
  ]);

  return (
    <div className="w-full max-w-7xl mx-auto">
      <CrmCampaignCockpit
        campaign={campaign}
        recipients={recipients}
        events={events}
      />
    </div>
  );
}
