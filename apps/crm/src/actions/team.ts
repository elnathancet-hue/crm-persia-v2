"use server";

import { requireRole } from "@/lib/auth";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function createTeamMember(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  role: string;
}) {
  const { orgId } = await requireRole("admin");

  const admin = getAdminSupabase();

  // 1. Create auth user with admin client
  const { data: newUser, error: authError } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true, // Auto-confirm email
    user_metadata: {
      full_name: `${data.firstName} ${data.lastName}`,
      name: `${data.firstName} ${data.lastName}`,
      phone: data.phone,
    },
  });

  if (authError) {
    if (authError.message.includes("already been registered")) {
      throw new Error("Este email ja esta cadastrado");
    }
    throw new Error(authError.message);
  }

  if (!newUser.user) throw new Error("Erro ao criar usuario");

  // 2. Create profile
  await admin.from("profiles").upsert({
    id: newUser.user.id,
    full_name: `${data.firstName} ${data.lastName}`,
    phone: data.phone,
  });

  // 3. Add to organization
  const { error: memberError } = await admin.from("organization_members").insert({
    user_id: newUser.user.id,
    organization_id: orgId,
    role: data.role,
    is_active: true,
  });

  if (memberError) throw new Error(memberError.message);

  revalidatePath("/settings/team");
  return { id: newUser.user.id, email: data.email };
}

export async function updateMemberRole(memberId: string, role: string) {
  const { orgId } = await requireRole("admin");

  const admin = getAdminSupabase();
  const { error } = await admin
    .from("organization_members")
    .update({ role })
    .eq("id", memberId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/team");
}

export async function toggleMemberActive(memberId: string) {
  const { orgId } = await requireRole("admin");

  const admin = getAdminSupabase();

  const { data: member } = await admin
    .from("organization_members")
    .select("is_active, role")
    .eq("id", memberId)
    .eq("organization_id", orgId)
    .single();

  if (!member) throw new Error("Membro nao encontrado");
  if (member.role === "owner") throw new Error("Nao pode desativar o dono");

  const { error } = await admin
    .from("organization_members")
    .update({ is_active: !member.is_active })
    .eq("id", memberId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/team");
}
