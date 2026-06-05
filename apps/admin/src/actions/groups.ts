"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { createProvider } from "@/lib/whatsapp/providers";
import { revalidatePath } from "next/cache";
import { fromAny } from "@/lib/ai-agent/db";

export interface AdminGroupMessage {
  id: string;
  direction: string;
  text: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  sender_avatar_url: string | null;
  created_at: string;
  media_url: string | null;
  media_type: string | null;
  is_pinned: boolean;
  sender_lead: {
    id: string;
    name: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
}

export interface AdminGroupParticipant {
  id: string;
  phone: string | null;
  name: string | null;
  avatar_url: string | null;
  joined_at: string | null;
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    status: string | null;
  } | null;
}

function phoneKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function phoneVariants(values: Array<string | null | undefined>): string[] {
  const variants = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const digits = value.replace(/\D/g, "");
    if (digits.length < 8) continue;
    variants.add(value);
    variants.add(digits);
    variants.add(`+${digits}`);
    if (digits.startsWith("55")) {
      variants.add(digits.slice(2));
      variants.add(`+${digits.slice(2)}`);
    }
  }
  return [...variants];
}

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
    // Cleanup (mai/2026): explicit field list completa. Org multi-conn
    // (uazapi + meta_cloud) com limit(1) sem filtro de provider podia
    // pegar a meta_cloud → listGroups() throw "method not supported".
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("provider", "uazapi")
    .eq("status", "connected")
    .limit(1)
    .single();

  if (!connection) return { error: "WhatsApp nao conectado" };

  try {
    const provider = createProvider(connection);
    const groups = await provider.listGroups({ noParticipants: true });

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
    console.error("[groups] sync failed", {
      organization_id: orgId,
      action: "sync_groups",
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Erro ao sincronizar" };
  }
}

/** Get WhatsApp connection provider for the active org. */
async function getProvider() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: connection } = await admin
    .from("whatsapp_connections")
    // Cleanup (mai/2026): explicit field list completa. Org multi-conn
    // (uazapi + meta_cloud) com limit(1) sem filtro de provider podia
    // pegar a meta_cloud → listGroups() throw "method not supported".
    .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("provider", "uazapi")
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
export async function createGroup(name: string, participants: string[] = []) {
  const { admin, orgId, provider } = await getProvider();
  const result = await provider.createGroup(name, participants);

  if (result.jid) {
    await admin.from("whatsapp_groups").insert({
      organization_id: orgId, group_jid: result.jid, name, participant_count: result.participantCount,
      invite_link: result.inviteLink || null,
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
  const info = await provider.getGroupInfo(groupJid, { getInviteLink: true }); return info.inviteLink || '';
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

export async function getGroupMessages(groupId: string, limit = 100): Promise<AdminGroupMessage[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const safeLimit = Math.min(Math.max(limit, 1), 250);
  const db = admin;

  const { data, error } = await fromAny(db, "group_messages")
    .select("id, direction, text, sender_name, sender_phone, sender_avatar_url, sender_lead_id, created_at, media_url, media_type, is_pinned")
    .eq("organization_id", orgId)
    .eq("group_id", groupId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(error.message);

  const rows = (data || []) as Array<Omit<AdminGroupMessage, "sender_lead"> & { sender_lead_id: string | null }>;
  const leadsById = new Map<string, AdminGroupMessage["sender_lead"]>();
  const leadsByPhone = new Map<string, AdminGroupMessage["sender_lead"]>();
  const leadIds = [...new Set(rows.map((row) => row.sender_lead_id).filter((id): id is string => Boolean(id)))];
  const phones = phoneVariants(rows.map((row) => row.sender_phone));

  const [leadsByIdResult, leadsByPhoneResult] = await Promise.all([
    leadIds.length
      ? admin.from("leads").select("id, name, phone, avatar_url").eq("organization_id", orgId).in("id", leadIds)
      : Promise.resolve({ data: [] }),
    phones.length
      ? admin.from("leads").select("id, name, phone, avatar_url").eq("organization_id", orgId).in("phone", phones)
      : Promise.resolve({ data: [] }),
  ]);
  for (const lead of [...(leadsByIdResult.data || []), ...(leadsByPhoneResult.data || [])]) {
    leadsById.set(lead.id, lead);
    const key = phoneKey(lead.phone);
    if (key) leadsByPhone.set(key, lead);
  }

  return rows.reverse().map(({ sender_lead_id, ...row }) => {
    const key = phoneKey(row.sender_phone);
    return {
      ...row,
      sender_lead:
        (sender_lead_id ? leadsById.get(sender_lead_id) : null) ??
        (key ? leadsByPhone.get(key) : null) ??
        null,
    };
  });
}

export async function getGroupParticipants(groupId: string): Promise<AdminGroupParticipant[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await fromAny(admin, "group_memberships")
    .select("id, phone, name, avatar_url, joined_at, lead_id")
    .eq("organization_id", orgId)
    .eq("group_id", groupId)
    .is("left_at", null)
    .order("joined_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data || []) as Array<Omit<AdminGroupParticipant, "lead"> & { lead_id: string | null }>;
  const leadsById = new Map<string, AdminGroupParticipant["lead"]>();
  const leadsByPhone = new Map<string, AdminGroupParticipant["lead"]>();
  const leadIds = [...new Set(rows.map((row) => row.lead_id).filter((id): id is string => Boolean(id)))];
  const phones = phoneVariants(rows.map((row) => row.phone));

  const [leadsByIdResult, leadsByPhoneResult] = await Promise.all([
    leadIds.length
      ? admin.from("leads").select("id, name, phone, email, avatar_url, status").eq("organization_id", orgId).in("id", leadIds)
      : Promise.resolve({ data: [] }),
    phones.length
      ? admin.from("leads").select("id, name, phone, email, avatar_url, status").eq("organization_id", orgId).in("phone", phones)
      : Promise.resolve({ data: [] }),
  ]);
  for (const lead of [...(leadsByIdResult.data || []), ...(leadsByPhoneResult.data || [])]) {
    leadsById.set(lead.id, lead);
    const key = phoneKey(lead.phone);
    if (key) leadsByPhone.set(key, lead);
  }

  return rows.map(({ lead_id, ...row }) => {
    const key = phoneKey(row.phone);
    return {
      ...row,
      lead:
        (lead_id ? leadsById.get(lead_id) : null) ??
        (key ? leadsByPhone.get(key) : null) ??
        null,
    };
  });
}
