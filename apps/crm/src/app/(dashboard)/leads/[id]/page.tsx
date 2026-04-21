import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getLead, getOrgTags } from "@/actions/leads";
import { LeadDetailClient } from "@/components/leads/lead-detail-client";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function LeadDetailPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  try {
    const [leadData, orgTags] = await Promise.all([
      getLead(id),
      getOrgTags(),
    ]);

    return (
      <div className="flex-1 p-4 md:p-6">
        <LeadDetailClient
          lead={leadData.lead}
          activities={leadData.activities}
          orgTags={orgTags}
        />
      </div>
    );
  } catch {
    notFound();
  }
}
