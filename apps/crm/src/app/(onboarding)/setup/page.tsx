import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/onboarding/setup-wizard";

export default async function SetupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(*)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member) redirect("/login");

  const org = (member as any).organizations;

  // Check if onboarding is already complete
  if (org?.onboarding_completed) redirect("/");

  const { data: progress } = await supabase
    .from("onboarding_progress")
    .select("*")
    .eq("organization_id", member.organization_id)
    .single();

  return (
    <div className="min-h-screen bg-background p-6">
      <SetupWizard
        initialStep={progress?.step || 1}
        initialData={(progress?.data as any) || {}}
        orgName={org?.name || ""}
        orgNiche={org?.niche || ""}
      />
    </div>
  );
}
