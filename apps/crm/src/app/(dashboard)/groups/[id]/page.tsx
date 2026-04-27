import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { GroupDetailClient } from "./group-detail-client";

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // .single() falha com PGRST116 pra users com 2+ memberships, o que
  // disparava redirect /login. Pega o mais antigo (padrao dashboard).
  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member) redirect("/login");

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("*")
    .eq("id", id)
    .eq("organization_id", member.organization_id)
    .single();

  if (!group) redirect("/groups");

  // Get leads for invite selector
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, phone")
    .eq("organization_id", member.organization_id)
    .not("phone", "is", null)
    .order("name")
    .limit(200);

  return (
    <GroupDetailClient group={group as never} leads={(leads || []) as never} />
  );
}
