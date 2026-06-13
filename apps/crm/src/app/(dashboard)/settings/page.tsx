import { createClient } from "@/lib/supabase/server";
import { OrgSettingsClient } from "./org-settings-client";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: member }, { data: profile }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("*, organizations(*)")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name, phone, avatar_url")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const org = (member as any)?.organizations;
  if (!org) return null;

  return (
    <OrgSettingsClient
      orgId={org?.id ?? ""}
      initialName={org?.name || ""}
      initialNiche={org?.niche || ""}
      initialWebsite={org?.website || ""}
      plan={org?.plan || "trial"}
      userEmail={user.email ?? ""}
      userFullName={(profile as any)?.full_name || ""}
      userPhone={(profile as any)?.phone || ""}
      userAvatarUrl={(profile as any)?.avatar_url || ""}
    />
  );
}
