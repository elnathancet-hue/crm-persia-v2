import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamPageClient } from "./team-client";

async function getTeamData() {
  const { orgId } = await requireRole("admin");

  // Use admin client to access auth.users for email
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("organization_members")
    .select("id, user_id, role, is_active, created_at, profiles(full_name, phone)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  // Get emails from auth
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
