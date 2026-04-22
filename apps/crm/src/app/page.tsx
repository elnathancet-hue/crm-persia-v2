import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check if onboarding is complete.
  // Picks the oldest active membership — same rule as pickActiveMembership in @/lib/auth.
  // .single() would explode for users with 2+ memberships (PGRST116).
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(onboarding_completed)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const org = (member as any)?.organizations;

  if (org && !org.onboarding_completed) {
    redirect("/setup");
  }

  redirect("/dashboard");
}
