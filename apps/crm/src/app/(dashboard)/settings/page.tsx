import { createClient } from "@/lib/supabase/server";
import { OrgSettingsClient } from "./org-settings-client";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // .single() falha com PGRST116 quando o user tem 2+ memberships.
  // Pega o mais antigo (mesmo padrao do dashboard).
  const { data: member } = await supabase
    .from("organization_members")
    .select("*, organizations(*)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

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
