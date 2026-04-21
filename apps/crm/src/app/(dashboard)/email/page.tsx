import { getEmailCampaigns } from "@/actions/email-campaigns";
import { EmailPageClient } from "./email-client";

export default async function EmailPage() {
  const campaigns = await getEmailCampaigns();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-heading">Email Marketing</h1>
        <p className="text-sm text-muted-foreground">
          Crie e gerencie campanhas de email para seus leads
        </p>
      </div>
      <EmailPageClient initialCampaigns={campaigns || []} />
    </div>
  );
}
