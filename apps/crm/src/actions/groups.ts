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

  const remoteGroups = await provider.listGroups();

  for (const group of remoteGroups) {
    if (!group.jid) continue;

    // Try to get invite link
    let inviteLink = "";
    try {
      inviteLink = await provider.getGroupInviteLink(group.jid);
    } catch { /* ignore */ }

    // Upsert
    await supabase
      .from("whatsapp_groups")
      .upsert(
        {
          organization_id: orgId,
          group_jid: group.jid,
          name: group.name,
          participant_count: group.participantCount,
          invite_link: inviteLink || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,group_jid" }
      );
  }

  revalidatePath("/groups");
  return { synced: remoteGroups.length };
}

// ---- Create group via UAZAPI ----
export async function createGroup(name: string, category: string = "geral") {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const result = await provider.createGroup(name);
  if (!result.jid) throw new Error("Erro ao criar grupo");

  // Get invite link
  let inviteLink = "";
  try {
    inviteLink = await provider.getGroupInviteLink(result.jid);
  } catch { /* ignore */ }

  const { data, error } = await supabase
    .from("whatsapp_groups")
    .insert({
      organization_id: orgId,
      group_jid: result.jid,
      name,
      category,
      invite_link: inviteLink || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/groups");
  return data;
}

// ---- Update group ----
export async function updateGroup(
  id: string,
  data: { name?: string; description?: string; is_announce?: boolean; category?: string }
) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  // Get the group from DB
  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  // Update on UAZAPI
  if (data.name) await provider.updateGroupName(group.group_jid, data.name);
  if (data.description !== undefined) await provider.updateGroupDescription(group.group_jid, data.description);
  if (data.is_announce !== undefined) await provider.setGroupAnnounce(group.group_jid, data.is_announce);

  // Update in DB
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

// ---- Get invite link ----
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

  if (group.invite_link) return group.invite_link;

  const link = await provider.getGroupInviteLink(group.group_jid);

  // Save to DB
  await supabase
    .from("whatsapp_groups")
    .update({ invite_link: link, updated_at: new Date().toISOString() })
    .eq("id", id);

  return link;
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
  let inviteLink = group.invite_link;
  if (!inviteLink) {
    inviteLink = await provider.getGroupInviteLink(group.group_jid);
    await supabase
      .from("whatsapp_groups")
      .update({ invite_link: inviteLink })
      .eq("id", groupId);
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

  return { sent: true };
}
