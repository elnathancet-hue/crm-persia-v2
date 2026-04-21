import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { TeamPageClient } from "./team-client";

async function getTeamData() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { members: [] };

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!member) return { members: [] };

  // Use admin client to access auth.users for email
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: members } = await admin
    .from("organization_members")
    .select("id, user_id, role, is_active, created_at, profiles(full_name, phone)")
    .eq("organization_id", member.organization_id)
    .order("created_at", { ascending: true });

  // Get emails from auth
  const userIds = (members || []).map((m: any) => m.user_id);
  const enriched = await Promise.all(
    (members || []).map(async (m: any) => {
      const { data: authUser } = await admin.auth.admin.getUserById(m.user_id);
      return {
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        is_active: m.is_active,
        created_at: m.created_at,
        email: authUser?.user?.email || "Sem email",
        name: m.profiles?.full_name || authUser?.user?.user_metadata?.full_name || "Sem nome",
      };
    })
  );

  return { members: enriched };
}

export default async function TeamPage() {
  const { members } = await getTeamData();

  return <TeamPageClient initialMembers={members} />;
}
