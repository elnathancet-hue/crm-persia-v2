"use server";

import { requireRole } from "@/lib/auth";
import { createProvider } from "@/lib/whatsapp/providers";
import { revalidatePath } from "next/cache";

async function getProvider(supabase: any, orgId: string) {
  const { data: connection } = await supabase
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();

  if (!connection) throw new Error("WhatsApp nao conectado");
  return createProvider(connection);
}

// ---- List groups from DB ----
export async function getGroups() {
  const { supabase, orgId } = await requireRole("admin");

  const { data, error } = await supabase
    .from("whatsapp_groups")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

// ---- Sync groups from UAZAPI to DB ----
export async function syncGroups() {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const remoteGroups = await provider.listGroups({ noParticipants: true });

  for (const group of remoteGroups) {
    if (!group.jid) continue;

    await supabase
      .from("whatsapp_groups")
      .upsert(
        {
          organization_id: orgId,
          group_jid: group.jid,
          name: group.name,
          participant_count: group.participantCount,
          invite_link: group.inviteLink || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,group_jid" }
      );
  }

  revalidatePath("/groups");
  return { synced: remoteGroups.length };
}

// ---- Create group via UAZAPI ----
export async function createGroup(name: string, participants: string[] = [], category: string = "geral") {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const result = await provider.createGroup(name, participants);
  if (!result.jid) throw new Error("Erro ao criar grupo");

  const { data, error } = await supabase
    .from("whatsapp_groups")
    .insert({
      organization_id: orgId,
      group_jid: result.jid,
      name,
      category,
      participant_count: result.participantCount,
      invite_link: result.inviteLink || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/groups");
  return data;
}

// ---- Update group settings ----
export async function updateGroup(
  id: string,
  data: {
    name?: string;
    description?: string;
    image?: string;
    is_announce?: boolean;
    locked?: boolean;
    join_approval_required?: boolean;
    member_add_mode?: "admin_add" | "all_member_add";
    ephemeral_duration?: "0" | "off" | "1d" | "7d" | "90d";
    category?: string;
  }
) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  const jid = group.group_jid as string;

  if (data.name) await provider.updateGroupName(jid, data.name);
  if (data.description !== undefined) await provider.updateGroupDescription(jid, data.description);
  if (data.image) await provider.updateGroupImage(jid, data.image);
  if (data.is_announce !== undefined) await provider.setGroupAnnounce(jid, data.is_announce);
  if (data.locked !== undefined) await provider.setGroupLocked(jid, data.locked);
  if (data.join_approval_required !== undefined) await provider.setGroupJoinApproval(jid, data.join_approval_required);
  if (data.member_add_mode !== undefined) await provider.setGroupMemberAddMode(jid, data.member_add_mode);
  if (data.ephemeral_duration !== undefined) await provider.setGroupEphemeral(jid, data.ephemeral_duration);

  const dbUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.name) dbUpdate.name = data.name;
  if (data.description !== undefined) dbUpdate.description = data.description;
  if (data.is_announce !== undefined) dbUpdate.is_announce = data.is_announce;
  if (data.category) dbUpdate.category = data.category;

  await supabase
    .from("whatsapp_groups")
    .update(dbUpdate as never)
    .eq("id", id)
    .eq("organization_id", orgId);

  revalidatePath("/groups");
}

// ---- Get invite link (fetches from UAZAPI if not cached) ----
export async function getInviteLink(id: string) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid, invite_link")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  if (group.invite_link) return group.invite_link as string;

  const info = await provider.getGroupInfo(group.group_jid as string, { getInviteLink: true });
  const link = info.inviteLink || "";

  await supabase
    .from("whatsapp_groups")
    .update({ invite_link: link, updated_at: new Date().toISOString() })
    .eq("id", id);

  return link;
}

// ---- Reset invite link ----
export async function resetInviteLink(id: string) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  const link = await provider.resetGroupInviteLink(group.group_jid as string);

  await supabase
    .from("whatsapp_groups")
    .update({ invite_link: link, updated_at: new Date().toISOString() })
    .eq("id", id);

  return link;
}

// ---- Join group by invite code ----
export async function joinGroupByInvite(inviteCode: string) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const group = await provider.joinGroup(inviteCode);
  if (!group.jid) throw new Error("Erro ao entrar no grupo");

  await supabase
    .from("whatsapp_groups")
    .upsert(
      {
        organization_id: orgId,
        group_jid: group.jid,
        name: group.name,
        participant_count: group.participantCount,
        invite_link: group.inviteLink || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,group_jid" }
    );

  revalidatePath("/groups");
  return group;
}

// ---- Leave group ----
export async function leaveGroup(id: string) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  await provider.leaveGroup(group.group_jid as string);

  await supabase
    .from("whatsapp_groups")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  revalidatePath("/groups");
}

// ---- Get group participants (from UAZAPI) ----
export async function getGroupParticipants(id: string) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  const info = await provider.getGroupInfo(group.group_jid as string);
  return info.participants;
}

// ---- Manage participants (add/remove/promote/demote/approve/reject) ----
export async function manageParticipants(
  id: string,
  action: "add" | "remove" | "promote" | "demote" | "approve" | "reject",
  phones: string[]
) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  const results = await provider.updateGroupParticipants(group.group_jid as string, action, phones);
  revalidatePath("/groups");
  return results;
}

// ---- Send invite to lead ----
export async function sendInviteToLead(groupId: string, leadId: string) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  // Get group
  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("name, invite_link, group_jid")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  // Get lead
  const { data: lead } = await supabase
    .from("leads")
    .select("phone, name")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();

  if (!lead?.phone) throw new Error("Lead sem telefone");

  // Get or fetch invite link
  let inviteLink = group.invite_link as string | null;
  if (!inviteLink) {
    const info = await provider.getGroupInfo(group.group_jid as string, { getInviteLink: true });
    inviteLink = info.inviteLink || null;
    if (inviteLink) {
      await supabase
        .from("whatsapp_groups")
        .update({ invite_link: inviteLink })
        .eq("id", groupId);
    }
  }

  // Send message with invite link
  const message = `Oi ${lead.name || ""}! Aqui esta o link para entrar no grupo *${group.name}*:\n\n${inviteLink}`;

  await provider.sendText({ phone: lead.phone, message });

  return { sent: true };
}

// ---- Delete group from DB (does NOT leave the WhatsApp group) ----
export async function deleteGroup(id: string) {
  const { supabase, orgId } = await requireRole("admin");

  await supabase
    .from("whatsapp_groups")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  revalidatePath("/groups");
}

// ---- Send message to group ----
export async function sendMessageToGroup(groupId: string, message: string) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  await provider.sendText({ phone: group.group_jid, message });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from("group_messages").insert({
    organization_id: orgId,
    group_id: groupId,
    direction: "outbound",
    text: message,
    sender_name: null,
    whatsapp_msg_id: null,
  });

  return { sent: true };
}

export async function getGroupMessages(groupId: string, limit = 50) {
  const { supabase, orgId } = await requireRole("agent");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("group_messages")
    .select("id, direction, text, sender_name, created_at")
    .eq("organization_id", orgId)
    .eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return (data || []) as Array<{ id: string; direction: string; text: string | null; sender_name: string | null; created_at: string }>;
}
