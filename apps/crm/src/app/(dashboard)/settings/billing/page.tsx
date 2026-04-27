import { createClient } from "@/lib/supabase/server";
import { BillingPageClient } from "./billing-client";

async function getBillingData() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // .single() falha pra users com 2+ memberships. Pega o mais antigo
  // (mesmo padrao do dashboard).
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(*)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member) return null;

  const org = (member as any)?.organizations;
  return {
    plan: org?.plan || "trial",
    name: org?.name || "",
    created_at: org?.created_at || "",
  };
}

export default async function BillingPage() {
  const billingData = await getBillingData();

  return (
    <BillingPageClient
      currentPlan={billingData?.plan || "trial"}
      orgName={billingData?.name || ""}
    />
  );
}
