"use server";

import { requireRole } from "@/lib/auth";
import { withAuditedAdmin } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { FULL_PERMISSIONS, type OrgPermissions } from "@/lib/permissions";

const ALLOWED_ROLES = ["admin", "agent", "viewer"] as const;
type AllowedRole = typeof ALLOWED_ROLES[number];

export async function createTeamMember(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  role: string;
  permissions?: OrgPermissions;
}) {
  const { orgId, userId } = await requireRole("admin");
  if (!ALLOWED_ROLES.includes(data.role as AllowedRole)) {
    throw new Error(`Role invalida: ${data.role}`);
  }

  const result = await withAuditedAdmin(
    {
      reason: "crm_create_team_member",
      userId,
      orgId,
      action: "crm_create_team_member",
      entityType: "member",
      metadata: { email: data.email, role: data.role },
    },
    async (admin) => {
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
        permissions: (data.permissions ?? FULL_PERMISSIONS) as never,
        is_active: true,
      });

      if (memberError) throw new Error(memberError.message);

      return { id: newUser.user.id, email: data.email };
    }
  );

  revalidatePath("/settings/team");
  return result;
}

export async function updateMemberRole(memberId: string, role: string) {
  const { orgId, userId } = await requireRole("admin");
  if (!ALLOWED_ROLES.includes(role as AllowedRole)) {
    throw new Error(`Role invalida: ${role}`);
  }

  await withAuditedAdmin(
    {
      reason: "crm_update_member_role",
      userId,
      orgId,
      action: "crm_update_member_role",
      entityType: "member",
      entityId: memberId,
      metadata: { role },
    },
    async (admin) => {
      // Guard: não rebaixar o último admin ativo
      if (role !== "admin") {
        const { data: current } = await admin
          .from("organization_members")
          .select("role")
          .eq("id", memberId)
          .eq("organization_id", orgId)
          .single();
        if (current?.role === "admin") {
          const { count } = await admin
            .from("organization_members")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("role", "admin")
            .eq("is_active", true);
          if ((count ?? 0) <= 1) {
            throw new Error("Não é possível rebaixar o único admin ativo da organização");
          }
        }
      }

      const { error } = await admin
        .from("organization_members")
        .update({ role })
        .eq("id", memberId)
        .eq("organization_id", orgId);

      if (error) throw new Error(error.message);
    }
  );
  revalidatePath("/settings/team");
}

export async function toggleMemberActive(memberId: string) {
  const { orgId, userId } = await requireRole("admin");

  await withAuditedAdmin(
    {
      reason: "crm_toggle_member_active",
      userId,
      orgId,
      action: "crm_toggle_member_active",
      entityType: "member",
      entityId: memberId,
    },
    async (admin) => {
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
    }
  );
  revalidatePath("/settings/team");
}

/**
 * Atualiza role + permissions de um membro atomicamente.
 * Chamado pelo preset-card da UI de equipe.
 * Owners nunca podem ter role/permissions alterados.
 */
export async function updateMemberPermissions(
  memberId: string,
  role: string,
  permissions: OrgPermissions,
) {
  const { orgId, userId } = await requireRole("admin");

  await withAuditedAdmin(
    {
      reason: "crm_update_member_permissions",
      userId,
      orgId,
      action: "crm_update_member_permissions",
      entityType: "member",
      entityId: memberId,
      metadata: { role },
    },
    async (admin) => {
      const { data: member } = await admin
        .from("organization_members")
        .select("role")
        .eq("id", memberId)
        .eq("organization_id", orgId)
        .single();

      if (!member) throw new Error("Membro nao encontrado");
      if (member.role === "owner") throw new Error("Nao pode alterar permissoes do dono");

      // Guard: não rebaixar o último admin ativo
      if (role !== "admin" && member.role === "admin") {
        const { count } = await admin
          .from("organization_members")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("role", "admin")
          .eq("is_active", true);
        if ((count ?? 0) <= 1) {
          throw new Error("Não é possível rebaixar o único admin ativo da organização");
        }
      }

      const { error } = await admin
        .from("organization_members")
        .update({ role, permissions: permissions as never })
        .eq("id", memberId)
        .eq("organization_id", orgId);

      if (error) throw new Error(error.message);
    }
  );
  revalidatePath("/settings/team");
}
