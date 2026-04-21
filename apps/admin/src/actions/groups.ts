"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { createProvider } from "@/lib/whatsapp/providers";
import { revalidatePath } from "next/cache";

/**
 * List WhatsApp groups for the active org context.
 * Data source: whatsapp_groups table (synced from UAZAPI).
 */
export async function getGroups() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin
    .from("whatsapp_groups")
    .select("*")
    .eq("organization_id", orgId)
    .order("name");
  if (error) return [];
  return data || [];
}

/**
 * Sync groups from UAZAPI to the database.
 * UAZAPI: GET /group/list (token) — returns all groups from the WhatsApp instance.
 * Upserts each group into whatsapp_groups by (organization_id, group_jid).
 */
export async function syncGroups() {
  const { admin, orgId } = await requireSuperadminForOrg();

  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();

  if (!connection) return { error: "WhatsApp nao conectado" };

  try {
    const provider = createProvider(connection);
    const groups = await provider.listGroups();

    for (const g of groups) {
      await admin.from("whatsapp_groups").upsert(
        {
          organization_id: orgId,
          group_jid: g.jid,
          name: g.name,
          participant_count: g.participantCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,group_jid" }
      );
    }

    revalidatePath("/groups");
    return { count: groups.length, error: null };
  } catch (err) {
    console.error("Erro ao sincronizar grupos:", err);
    return { error: "Erro ao sincronizar" };
  }
}

/** Get WhatsApp connection provider for the active org. */
async function getProvider() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: connection } = await admin
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .single();
  if (!connection) throw new Error("WhatsApp nao conectado");
  return { admin, orgId, provider: createProvider(connection) };
}

/**
 * Create a WhatsApp group via UAZAPI and save to DB.
 * UAZAPI: POST /group/create (token) — { name, participants: [] }
 * Then: GET /group/invitelink (token) — { GroupJID } → returns InviteLink
 */
export async function createGroup(name: string) {
  const { admin, orgId, provider } = await getProvider();
  const result = await provider.createGroup(name);

  if (result.jid) {
    const inviteLink = await provider.getGroupInviteLink(result.jid).catch(() => "");
    await admin.from("whatsapp_groups").insert({
      organization_id: orgId, group_jid: result.jid, name, participant_count: 0,
      invite_link: inviteLink,
    });
  }
  revalidatePath("/groups");
  return result;
}

/**
 * Get group info from UAZAPI.
 * UAZAPI: POST /group/info (token) — { groupjid }
 * Note: doc says POST, provider uses GET — UAZAPI accepts both.
 */
export async function getGroupInfo(groupJid: string) {
  const { provider } = await getProvider();
  return provider.getGroupInfo(groupJid);
}

/**
 * Get group invite link from UAZAPI.
 * UAZAPI: GET /group/invitelink (token) — { GroupJID }
 * Note: doc says /group/inviteInfo, code uses /group/invitelink — may be alias.
 */
export async function getGroupInviteLink(groupJid: string) {
  const { provider } = await getProvider();
  return provider.getGroupInviteLink(groupJid);
}

/**
 * Send text message to a WhatsApp group.
 * UAZAPI: POST /send/text (token) — { number: groupJid, text: message }
 * Group JIDs use format: 120363...@g.us
 */
export async function sendMessageToGroup(groupJid: string, message: string) {
  const { provider } = await getProvider();
  return provider.sendText({ phone: groupJid, message });
}
