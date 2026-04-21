import { createClient } from "@/lib/supabase/server";
import { OrgSettingsClient } from "./org-settings-client";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: member } = await supabase
    .from("organization_members")
    .select("*, organizations(*)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  const org = (member as any)?.organizations;

  const settings = (org?.settings || {}) as Record<string, unknown>;
  const aiContext = (settings.ai_context || {}) as Record<string, string>;

  return (
    <OrgSettingsClient
      orgId={org?.id}
      initialName={org?.name || ""}
      initialNiche={org?.niche || ""}
      initialWebsite={org?.website || ""}
      plan={org?.plan || "trial"}
      initialAiContext={{
        product: aiContext.product || "",
        target_audience: aiContext.target_audience || "",
        sales_goal: aiContext.sales_goal || "",
        restrictions: aiContext.restrictions || "",
        key_info: aiContext.key_info || "",
      }}
    />
  );
}
