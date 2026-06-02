"use server";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProvider } from "@/lib/whatsapp/providers";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createHash } from "crypto";
import {
  linkGroupMembership,
  normalizePhoneBR,
  generatePhoneVariants,
  matchLeadByName,
  matchLeadByPhone,
} from "@/lib/whatsapp/group-join-pipeline";

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

async function getRemoteChatImageUrl(
  provider: {
    getChatImageUrl(chatId: string, opts?: { preview?: boolean }): Promise<string | null>;
    getGroupInfo(jid: string, opts?: { force?: boolean }): Promise<{ imageUrl?: string | null }>;
  },
  chatId: string,
): Promise<string | null> {
  const detailsImage = await provider.getChatImageUrl(chatId, { preview: true }).catch(() => null);
  if (detailsImage) return detailsImage;

  const groupInfo = await provider.getGroupInfo(chatId, { force: true }).catch(() => null);
  return groupInfo?.imageUrl ?? null;
}

// ── GroupParticipantView — modelo normalizado para UI (Etapa 1 do roadmap) ────
export interface GroupParticipantView {
  /** Chave estável para a lista — rawJid ou fallback gerado. */
  id: string;
  rawJid: string;
  /** Telefone E.164 extraído do JID. Null para @lid sem PhoneNumber separado. */
  phone: string | null;
  displayName: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** "phone" = JID com telefone real | "lid" = ID interno WA | "unknown" = outro */
  identityKind: "phone" | "lid" | "unknown";
  lead: null | {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    status: string | null;
  };
  membershipId: string | null;
}

// ── GroupOverview type (enriquecido com stats de membros) ─────────────────────
export interface GroupOverview {
  id: string;
  name: string;
  description: string | null;
  group_jid: string;
  participant_count: number;
  max_participants: number;
  is_accepting: boolean;
  is_announce: boolean;
  category: string;
  campaign_id: string | null;
  campaign_name: string | null;
  invite_link: string | null;
  identified_leads: number;
  duplicates: number;
  created_at: string;
  // Etapa 7: métricas comerciais
  /** Membros ativos com telefone mas sem lead vinculado. */
  unidentified_count: number;
  /** Membros ativos sem telefone (participantes @lid). */
  lid_count: number;
  /** Membros que enviaram ao menos 1 mensagem inbound no grupo. */
  engaged_count: number;
  /** Saídas nos últimos 7 dias. */
  recent_exits: number;
  /** Imagem cacheada do grupo (Etapa 5). */
  image_url: string | null;
}

// ---- Groups overview with membership stats ----
export async function getGroupsOverview(): Promise<GroupOverview[]> {
  const { supabase, orgId } = await requireRole("admin");

  const db = supabase as any; // migration 079 tables not in generated types yet

  const { data: groups, error } = await db
    .from("whatsapp_groups")
    .select("*, group_campaigns(name)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!groups || groups.length === 0) return [];

  const groupIds = (groups as { id: string }[]).map((g) => g.id);

  // Get memberships linked to leads — só membros ativos (left_at IS NULL).
  // Ex-membros não devem inflar identified_leads nem duplicates.
  const { data: memberships } = await db
    .from("group_memberships")
    .select("group_id, lead_id")
    .eq("organization_id", orgId)
    .in("group_id", groupIds)
    .not("lead_id", "is", null)
    .is("left_at", null);

  const allMemberships = (memberships || []) as { group_id: string; lead_id: string }[];

  // Não identificados e LID: membros ativos sem lead
  const { data: unidentifiedMemberships } = await db
    .from("group_memberships")
    .select("group_id, phone")
    .eq("organization_id", orgId)
    .in("group_id", groupIds)
    .is("lead_id", null)
    .is("left_at", null);

  const unidentifiedByGroup = new Map<string, number>();
  const lidByGroup = new Map<string, number>();
  for (const m of (unidentifiedMemberships || []) as { group_id: string; phone: string | null }[]) {
    if (m.phone) {
      unidentifiedByGroup.set(m.group_id, (unidentifiedByGroup.get(m.group_id) || 0) + 1);
    } else {
      lidByGroup.set(m.group_id, (lidByGroup.get(m.group_id) || 0) + 1);
    }
  }

  // Engajados: membros com pelo menos 1 msg inbound (distinct sender_jid por grupo)
  const { data: inboundMsgs } = await db
    .from("group_messages")
    .select("group_id, sender_jid")
    .eq("organization_id", orgId)
    .in("group_id", groupIds)
    .eq("direction", "inbound")
    .not("sender_jid", "is", null);

  const engagedByGroup = new Map<string, Set<string>>();
  for (const m of (inboundMsgs || []) as { group_id: string; sender_jid: string }[]) {
    if (!engagedByGroup.has(m.group_id)) engagedByGroup.set(m.group_id, new Set());
    engagedByGroup.get(m.group_id)!.add(m.sender_jid);
  }

  // Saídas recentes: left_at nos últimos 7 dias
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentExits } = await db
    .from("group_memberships")
    .select("group_id")
    .eq("organization_id", orgId)
    .in("group_id", groupIds)
    .gte("left_at", sevenDaysAgo);

  const recentExitsByGroup = new Map<string, number>();
  for (const m of (recentExits || []) as { group_id: string }[]) {
    recentExitsByGroup.set(m.group_id, (recentExitsByGroup.get(m.group_id) || 0) + 1);
  }

  // Identified leads per group
  const identifiedByGroup = new Map<string, Set<string>>();
  for (const m of allMemberships) {
    if (!identifiedByGroup.has(m.group_id)) identifiedByGroup.set(m.group_id, new Set());
    identifiedByGroup.get(m.group_id)!.add(m.lead_id);
  }

  // Duplicate detection: leads present in >1 group
  const leadGroups = new Map<string, Set<string>>();
  for (const m of allMemberships) {
    if (!leadGroups.has(m.lead_id)) leadGroups.set(m.lead_id, new Set());
    leadGroups.get(m.lead_id)!.add(m.group_id);
  }
  const duplicatesByGroup = new Map<string, number>();
  for (const [, gSet] of leadGroups.entries()) {
    if (gSet.size > 1) {
      for (const gid of gSet) {
        duplicatesByGroup.set(gid, (duplicatesByGroup.get(gid) || 0) + 1);
      }
    }
  }

  return (groups as any[]).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    description: g.description as string | null,
    group_jid: g.group_jid as string,
    participant_count: (g.participant_count as number) || 0,
    max_participants: (g.max_participants as number) || 256,
    is_accepting: g.is_accepting as boolean,
    is_announce: g.is_announce as boolean,
    category: g.category as string,
    campaign_id: g.campaign_id as string | null,
    campaign_name: (g.group_campaigns as { name?: string } | null)?.name ?? null,
    invite_link: g.invite_link as string | null,
    identified_leads: identifiedByGroup.get(g.id as string)?.size ?? 0,
    duplicates: duplicatesByGroup.get(g.id as string) ?? 0,
    created_at: g.created_at as string,
    unidentified_count: unidentifiedByGroup.get(g.id as string) ?? 0,
    lid_count: lidByGroup.get(g.id as string) ?? 0,
    engaged_count: engagedByGroup.get(g.id as string)?.size ?? 0,
    recent_exits: recentExitsByGroup.get(g.id as string) ?? 0,
    image_url: (g.image_url as string | null) ?? null,
  }));
}

// ---- List groups from DB ----
export async function getGroups() {
  const { supabase, orgId } = await requireRole("admin");

  const { data: groups, error } = await supabase
    .from("whatsapp_groups")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!groups || groups.length === 0) return [];

  // Última mensagem por grupo — query única, deduplicada em JS
  const groupIds = (groups as { id: string }[]).map((g) => g.id);
  const { data: lastMsgs } = await (supabase as any)
    .from("group_messages")
    .select("group_id, text, sender_name, direction, created_at")
    .eq("organization_id", orgId)
    .in("group_id", groupIds)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(groupIds.length * 3 + 10);

  const lastMsgByGroup = new Map<string, {
    text: string | null;
    sender_name: string | null;
    direction: string;
    created_at: string;
  }>();
  for (const msg of (lastMsgs || []) as any[]) {
    if (!lastMsgByGroup.has(msg.group_id as string)) {
      lastMsgByGroup.set(msg.group_id as string, msg);
    }
  }

  return (groups as any[]).map((g) => {
    const lm = lastMsgByGroup.get(g.id as string);
    return {
      ...g,
      last_message_text: lm?.text ?? null,
      last_message_sender: lm?.sender_name ?? null,
      last_message_direction: lm?.direction ?? null,
      last_message_at: lm?.created_at ?? null,
    };
  });
}

// ---- Sync groups from UAZAPI to DB ----
export async function syncGroups() {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  // Carrega grupos em páginas de 100 para suportar contas com muitos grupos.
  // Precisamos de Participants para calcular participant_count corretamente.
  const PAGE_SIZE = 100;
  let offset = 0;
  const remoteGroups: Awaited<ReturnType<typeof provider.listGroups>> = [];
  while (true) {
    const page = await provider.listGroupsPaged({
      limit: PAGE_SIZE,
      offset,
      noParticipants: false,
      force: true,
    });
    remoteGroups.push(...page.groups);
    if (page.groups.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const admin = createAdminClient() as any;

  for (const group of remoteGroups) {
    if (!group.jid) continue;

    const { data: savedGroup } = await supabase
      .from("whatsapp_groups")
      .upsert(
        {
          organization_id: orgId,
          group_jid: group.jid,
          name: group.name,
          description: group.description || null,
          participant_count: group.participantCount,
          invite_link: group.inviteLink || null,
          is_announce: group.announce ?? false,
          is_locked: group.locked ?? false,
          is_join_approval_required: group.joinApprovalRequired ?? false,
          member_add_mode: group.memberAddMode ?? "all_member_add",
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "organization_id,group_jid" }
      )
      .select("id, image_url, image_fetched_at")
      .single() as any;

    // Etapa 5: cachear foto do grupo, usando /chat/details como fallback.
    if (savedGroup?.id && !savedGroup.image_url) {
      const { cacheGroupAvatarFromUrl } = await import("@/lib/lead-avatar-cache");
      const remoteImageUrl =
        group.imageUrl ??
        await provider.getChatImageUrl(group.jid, { preview: true }).catch(() => null);
      cacheGroupAvatarFromUrl({
        organizationId: orgId,
        groupId: savedGroup.id,
        remoteUrl: remoteImageUrl,
        currentImageUrl: savedGroup.image_url,
      }).catch(() => {});
    }
  }

  void admin; // satisfaz TS (usado apenas para tipo)
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
  if (data.locked !== undefined) dbUpdate.is_locked = data.locked;
  if (data.join_approval_required !== undefined) dbUpdate.is_join_approval_required = data.join_approval_required;
  if (data.member_add_mode !== undefined) dbUpdate.member_add_mode = data.member_add_mode;
  if (data.ephemeral_duration !== undefined) dbUpdate.ephemeral_duration = data.ephemeral_duration;
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

  const info = await provider.getGroupInfo(group.group_jid as string, { force: true });
  return info.participants;
}

// ── getGroupParticipantsView ───────────────────────────────────────────────────
// Modelo enriquecido para UI (Etapa 1 do roadmap).
// Combina participantes ao vivo da UAZAPI com group_memberships e leads do DB.
// Retorna TODOS os participantes, identificados ou não — nunca filtra silenciosamente.

export async function getGroupParticipantsView(groupId: string): Promise<GroupParticipantView[]> {
  const { orgId } = await requireRole("agent");
  const adminDb = createAdminClient() as any;

  // Busca grupo (JID) com adminDb para bypass da RLS
  const { data: grp } = await adminDb
    .from("whatsapp_groups")
    .select("id, group_jid")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!grp) throw new Error("Grupo não encontrado");

  // Participantes ao vivo da UAZAPI
  let rawParticipants: Array<{ jid: string; isAdmin: boolean; isSuperAdmin: boolean }> = [];
  try {
    const provider = await getProvider(adminDb, orgId);
    const info = await provider.getGroupInfo(grp.group_jid as string, { force: true });
    rawParticipants = (info.participants || []).filter((p) => p.jid);
  } catch (err) {
    console.error("[getGroupParticipantsView] getGroupInfo falhou:", err);
    // Continua com lista vazia — caller deve tratar o estado de erro
  }

  // Memberships ativos + dados do lead num único SELECT
  const { data: memberships } = await adminDb
    .from("group_memberships")
    .select(`
      id,
      phone,
      lead_id,
      leads (
        id,
        name,
        phone,
        email,
        avatar_url,
        status
      )
    `)
    .eq("group_id", groupId)
    .eq("organization_id", orgId)
    .is("left_at", null);

  // Índice rápido: phone E.164 → membership
  const membershipByPhone = new Map<string, { id: string; lead: GroupParticipantView["lead"] }>();
  for (const m of (memberships || []) as Array<{
    id: string;
    phone: string | null;
    lead_id: string | null;
    leads: GroupParticipantView["lead"] | null;
  }>) {
    if (m.phone) {
      membershipByPhone.set(m.phone, {
        id: m.id,
        lead: m.leads ?? null,
      });
    }
  }

  return rawParticipants.map((p) => {
    const jid = p.jid;

    // Determina identityKind
    let identityKind: GroupParticipantView["identityKind"] = "unknown";
    if (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us")) {
      identityKind = "phone";
    } else if (jid.endsWith("@lid")) {
      identityKind = "lid";
    }

    // Normaliza telefone — apenas para JIDs com número real
    const phone = identityKind === "phone" ? (normalizePhoneBR(jid) ?? null) : null;

    // Vincula membership/lead pelo telefone normalizado
    const membership = phone ? (membershipByPhone.get(phone) ?? null) : null;

    return {
      id: jid,
      rawJid: jid,
      phone,
      displayName: null, // UAZAPI não retorna push name na lista de participantes
      isAdmin: p.isAdmin,
      isSuperAdmin: p.isSuperAdmin,
      identityKind,
      lead: membership?.lead ?? null,
      membershipId: membership?.id ?? null,
    };
  });
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
export async function sendMessageToGroup(
  groupId: string,
  message: string,
  replyToWamid?: string | null,
) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  const result = await provider.sendText({
    phone: group.group_jid,
    message,
    replyTo: replyToWamid || undefined,
  });

  await (supabase as any).from("group_messages").insert({
    organization_id: orgId,
    group_id: groupId,
    direction: "outbound",
    text: message,
    sender_name: null,
    whatsapp_msg_id: result.messageId || null,
    reply_to_whatsapp_msg_id: replyToWamid || null,
  });

  return { sent: true };
}

// ---- Send media to group ----
export async function sendMediaToGroup(
  groupId: string,
  fileBase64: string,
  mediaType: "image" | "video" | "audio" | "document",
  caption?: string,
  fileName?: string,
  replyToWamid?: string | null,
) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  const result = await provider.sendMedia({
    phone: group.group_jid,
    media: fileBase64,
    type: mediaType,
    caption,
    fileName,
    replyTo: replyToWamid || undefined,
  });

  await (supabase as any).from("group_messages").insert({
    organization_id: orgId,
    group_id: groupId,
    direction: "outbound",
    text: caption || null,
    sender_name: null,
    whatsapp_msg_id: result.messageId || null,
    media_type: mediaType,
    media_url: null, // base64 not stored; UAZAPI returns no URL
    reply_to_whatsapp_msg_id: replyToWamid || null,
  });

  return { sent: true };
}

export async function generateGroupMessageDraft(
  groupId: string,
  prompt: string,
): Promise<{ suggestion: string; error?: string }> {
  const trimmed = prompt.trim();
  if (!trimmed) return { suggestion: "", error: "Prompt vazio" };

  const { supabase, orgId } = await requireRole("agent");
  const db = supabase as any;

  const { data: group } = await db
    .from("whatsapp_groups")
    .select("name, category")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!group) return { suggestion: "", error: "Grupo nao encontrado" };

  const { data: recentMessages } = await db
    .from("group_messages")
    .select("direction, text, sender_name, created_at, media_type")
    .eq("organization_id", orgId)
    .eq("group_id", groupId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(12);

  const history = ((recentMessages ?? []) as Array<{
    direction: "inbound" | "outbound";
    text: string | null;
    sender_name: string | null;
    media_type: string | null;
  }>)
    .reverse()
    .map((message) => {
      const sender = message.direction === "outbound"
        ? "Operador"
        : message.sender_name || "Participante";
      return `${sender}: ${message.text || message.media_type || "Midia"}`;
    })
    .join("\n");

  try {
    const { chatCompletion } = await import("@/lib/ai/openai");
    const suggestion = await chatCompletion(
      [
        "Voce e um assistente de atendimento para WhatsApp em grupos.",
        "Gere uma resposta curta, clara e natural em portugues do Brasil.",
        "Nao use saudacoes longas, nao invente dados e nao envie markdown.",
      ].join(" "),
      [{
        role: "user",
        content: [
          `Grupo: ${group.name || "Grupo"} (${group.category || "geral"})`,
          history ? `Historico recente:\n${history}` : "Historico recente: vazio",
          `Pedido do operador: ${trimmed}`,
        ].join("\n\n"),
      }],
      { temperature: 0.5, maxTokens: 280 },
    );

    return { suggestion: suggestion.trim() };
  } catch (err) {
    return {
      suggestion: "",
      error: err instanceof Error ? err.message : "Erro ao gerar sugestao",
    };
  }
}

// ---- Delete group message ----
export async function deleteGroupMessage(
  groupId: string,
  messageId: string,
  whatsappMsgId?: string | null,
) {
  const { supabase, orgId } = await requireRole("admin");
  const db = supabase as any;

  // Attempt UAZAPI deletion (best-effort — only if we have the WA msg ID)
  if (whatsappMsgId) {
    try {
      const provider = await getProvider(supabase, orgId);
      const { data: group } = await supabase
        .from("whatsapp_groups")
        .select("group_jid")
        .eq("id", groupId)
        .eq("organization_id", orgId)
        .single();
      if (group) {
        await provider.deleteMessage(group.group_jid, whatsappMsgId);
      }
    } catch {
      // UAZAPI deletion failed — still soft-delete from DB
    }
  }

  await db
    .from("group_messages")
    .update({ is_deleted: true })
    .eq("id", messageId)
    .eq("organization_id", orgId);
}

// ---- React to group message ----
export async function reactToGroupMessage(
  groupId: string,
  whatsappMsgId: string,
  emoji: string,
) {
  const { supabase, orgId } = await requireRole("admin");
  const provider = await getProvider(supabase, orgId);

  const { data: group } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .single();

  if (!group) throw new Error("Grupo nao encontrado");

  await provider.reactToMessage(group.group_jid, whatsappMsgId, emoji);
}

export async function getGroupMessages(groupId: string, limit = 50) {
  const { supabase, orgId } = await requireRole("agent");

  const db = supabase as any;
  const { data } = await db
    .from("group_messages")
    .select(
      "id, direction, text, sender_name, sender_jid, sender_phone, " +
      "sender_lead_id, sender_membership_id, sender_identity_kind, sender_avatar_url, " +
      "created_at, whatsapp_msg_id, media_url, media_type, reply_to_whatsapp_msg_id"
    )
    .eq("organization_id", orgId)
    .eq("group_id", groupId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true })
    .limit(limit);

  const rows = ((data || []) as Array<{
    id: string;
    direction: string;
    text: string | null;
    sender_name: string | null;
    sender_jid: string | null;
    sender_phone: string | null;
    sender_lead_id: string | null;
    sender_membership_id: string | null;
    sender_identity_kind: "phone" | "lid" | "unknown" | null;
    sender_avatar_url: string | null;
    created_at: string;
    whatsapp_msg_id: string | null;
    media_url: string | null;
    media_type: string | null;
    reply_to_whatsapp_msg_id: string | null;
    sender_lead?: {
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      avatar_url: string | null;
      status: string | null;
    } | null;
  }>);

  const resolvedLeadIds = new Set<string>();
  const patches: Array<{ messageId: string; leadId: string }> = [];

  for (const row of rows) {
    if (row.sender_lead_id) {
      resolvedLeadIds.add(row.sender_lead_id);
      continue;
    }

    let match: { id: string } | null = null;
    if (row.sender_phone) {
      match = await matchLeadByPhone(supabase, orgId, row.sender_phone);
    }
    if (!match && row.sender_name && row.sender_name.trim().length >= 4) {
      match = await matchLeadByName(supabase, orgId, row.sender_name.trim());
    }

    if (match?.id) {
      row.sender_lead_id = match.id;
      resolvedLeadIds.add(match.id);
      patches.push({ messageId: row.id, leadId: match.id });
    }
  }

  if (patches.length > 0) {
    await Promise.allSettled(
      patches.map((patch) =>
        db
          .from("group_messages")
          .update({ sender_lead_id: patch.leadId })
          .eq("id", patch.messageId)
          .eq("organization_id", orgId)
          .is("sender_lead_id", null),
      ),
    );
  }

  const avatarLookups = new Map<string, Array<(typeof rows)[number]>>();
  for (const row of rows) {
    if (row.direction !== "inbound" || row.sender_avatar_url) continue;
    const lookup = (row.sender_phone ?? row.sender_jid)?.replace(/^\+/, "");
    if (!lookup) continue;
    const bucket = avatarLookups.get(lookup) ?? [];
    bucket.push(row);
    avatarLookups.set(lookup, bucket);
  }

  if (avatarLookups.size > 0) {
    const provider = await getProvider(supabase, orgId).catch(() => null);
    if (provider) {
      await Promise.allSettled(
        Array.from(avatarLookups.entries()).slice(0, 8).map(async ([lookup, lookupRows]) => {
          const avatarUrl = await provider.getChatImageUrl(lookup, { preview: true }).catch(() => null);
          if (!avatarUrl) return;

          for (const row of lookupRows) {
            row.sender_avatar_url = avatarUrl;
          }

          await db
            .from("group_messages")
            .update({ sender_avatar_url: avatarUrl })
            .eq("organization_id", orgId)
            .eq("group_id", groupId)
            .in("id", lookupRows.map((row) => row.id));

          const first = lookupRows[0];
          if (first?.sender_membership_id) {
            await db
              .from("group_memberships")
              .update({ avatar_url: avatarUrl, avatar_fetched_at: new Date().toISOString() })
              .eq("id", first.sender_membership_id)
              .eq("organization_id", orgId);
          } else if (first?.sender_phone) {
            await db
              .from("group_memberships")
              .update({ avatar_url: avatarUrl, avatar_fetched_at: new Date().toISOString() })
              .eq("organization_id", orgId)
              .eq("group_id", groupId)
              .eq("phone", first.sender_phone);
          }
        }),
      );
    }
  }

  const leadsById = new Map<string, {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    status: string | null;
  }>();

  if (resolvedLeadIds.size > 0) {
    const { data: leads } = await db
      .from("leads")
      .select("id, name, phone, email, avatar_url, status")
      .eq("organization_id", orgId)
      .in("id", Array.from(resolvedLeadIds));

    for (const lead of (leads || []) as Array<{
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      avatar_url: string | null;
      status: string | null;
    }>) {
      leadsById.set(lead.id, lead);
    }
  }

  return rows.map((row) => ({
    ...row,
    sender_lead: row.sender_lead_id
      ? (leadsById.get(row.sender_lead_id) ?? null)
      : null,
  }));
}

// ─── createLeadFromGroupParticipant (Etapa 2) ─────────────────────────────────
// Cria ou vincula lead a partir de um participante do grupo.
// Idempotente: createLead faz upsert por telefone.
export async function createLeadFromGroupParticipant(input: {
  groupId: string;
  membershipId?: string | null;
  phone: string;
  name?: string | null;
}): Promise<{ leadId: string }> {
  const { orgId } = await requireRole("agent");
  const adminDb = createAdminClient() as any;

  const { createLead: createLeadShared } = await import("@persia/shared/crm");
  const lead = await createLeadShared({ db: adminDb, orgId }, {
    name: input.name || null,
    phone: input.phone,
    source: "group",
  });

  // Vincular membership ao lead criado
  if (input.membershipId) {
    await adminDb
      .from("group_memberships")
      .update({ lead_id: lead.id })
      .eq("id", input.membershipId)
      .eq("organization_id", orgId);
  }

  // Atualizar sender_lead_id em mensagens históricas deste telefone neste grupo
  await adminDb
    .from("group_messages")
    .update({ sender_lead_id: lead.id })
    .eq("group_id", input.groupId)
    .eq("organization_id", orgId)
    .eq("sender_phone", input.phone)
    .is("sender_lead_id", null);

  revalidatePath("/groups");
  return { leadId: lead.id };
}

// ─── Group Campaigns ──────────────────────────────────────────────────────────

export interface GroupCampaign {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  distribution_mode: "sequential" | "balanced";
  fallback_url: string | null;
  fallback_message: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function getGroupCampaigns() {
  const { supabase, orgId } = await requireRole("admin");
  const { data, error } = await (supabase as any)
    .from("group_campaigns")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as GroupCampaign[];
}

export async function createGroupCampaign(input: {
  name: string;
  slug: string;
  description?: string;
  distribution_mode?: "sequential" | "balanced";
  fallback_url?: string;
}) {
  const { supabase, orgId } = await requireRole("admin");
  const slug = input.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const { data, error } = await (supabase as any)
    .from("group_campaigns")
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || null,
      distribution_mode: input.distribution_mode || "balanced",
      fallback_url: input.fallback_url?.trim() || null,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Slug já em uso nesta organização");
    throw new Error(error.message);
  }
  revalidatePath("/groups");
  return data as GroupCampaign;
}

export async function updateGroupCampaign(
  id: string,
  input: Partial<Pick<GroupCampaign, "name" | "slug" | "description" | "distribution_mode" | "fallback_url" | "fallback_message" | "is_active">>
) {
  const { supabase, orgId } = await requireRole("admin");
  const update: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };
  if (input.slug) {
    update.slug = input.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  const { error } = await (supabase as any)
    .from("group_campaigns")
    .update(update)
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  revalidatePath("/groups");
}

export async function deleteGroupCampaign(id: string) {
  const { supabase, orgId } = await requireRole("admin");
  // Unlink groups first
  await (supabase as any)
    .from("whatsapp_groups")
    .update({ campaign_id: null })
    .eq("campaign_id", id)
    .eq("organization_id", orgId);
  const { error } = await (supabase as any)
    .from("group_campaigns")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  revalidatePath("/groups");
}

export async function linkGroupToCampaign(groupId: string, campaignId: string | null) {
  const { supabase, orgId } = await requireRole("admin");
  const { error } = await (supabase as any)
    .from("whatsapp_groups")
    .update({ campaign_id: campaignId, updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  revalidatePath("/groups");
}

export async function setGroupCapacity(groupId: string, maxParticipants: number, isAccepting: boolean) {
  const { supabase, orgId } = await requireRole("admin");
  const { error } = await (supabase as any)
    .from("whatsapp_groups")
    .update({ max_participants: maxParticipants, is_accepting: isAccepting, updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  revalidatePath("/groups");
}

// ─── Smart link (public — uses admin client, no user auth) ───────────────────

export interface SmartLinkResolution {
  status: "ok" | "full" | "inactive";
  organizationId: string;
  campaign: { id: string; name: string; description: string | null; fallback_url: string | null; fallback_message: string | null };
  organization: { name: string; logo_url: string | null };
  group?: { id: string; invite_link: string; name: string };
}

export async function resolveSmartLink(orgSlug: string, campaignSlug: string): Promise<SmartLinkResolution | null> {
  const db = createAdminClient() as any;

  // Find org by slug
  const { data: org } = await db
    .from("organizations")
    .select("id, name, logo_url")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (!org) return null;

  // Find active campaign
  const { data: campaign } = await db
    .from("group_campaigns")
    .select("id, name, description, distribution_mode, fallback_url, fallback_message, is_active")
    .eq("organization_id", org.id)
    .eq("slug", campaignSlug)
    .maybeSingle();
  if (!campaign) return null;

  const campaignMeta = {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    fallback_url: campaign.fallback_url,
    fallback_message: campaign.fallback_message,
  };
  const orgMeta = { name: org.name, logo_url: org.logo_url };

  if (!campaign.is_active) {
    return { status: "inactive", organizationId: org.id, campaign: campaignMeta, organization: orgMeta };
  }

  // Find available groups for this campaign
  const { data: groups } = await db
    .from("whatsapp_groups")
    .select("id, name, invite_link, participant_count, max_participants, is_accepting")
    .eq("organization_id", org.id)
    .eq("campaign_id", campaign.id)
    .eq("is_accepting", true)
    .not("invite_link", "is", null);

  if (!groups || groups.length === 0) {
    return { status: "full", organizationId: org.id, campaign: campaignMeta, organization: orgMeta };
  }

  // Filter actually available (below capacity)
  const available = groups.filter(
    (g: any) => (g.participant_count ?? 0) < (g.max_participants ?? 256)
  );

  if (available.length === 0) {
    return { status: "full", organizationId: org.id, campaign: campaignMeta, organization: orgMeta };
  }

  let chosen: any;
  if (campaign.distribution_mode === "sequential") {
    // Fill groups in order — pick the one with fewest remaining spots that still has space
    // (i.e. most full, but not yet over capacity)
    chosen = available.sort(
      (a: any, b: any) =>
        ((b.participant_count ?? 0) / (b.max_participants ?? 256)) -
        ((a.participant_count ?? 0) / (a.max_participants ?? 256))
    )[0];
  } else {
    // Balanced — pick the group with most remaining capacity
    chosen = available.sort(
      (a: any, b: any) =>
        ((a.participant_count ?? 0) / (a.max_participants ?? 256)) -
        ((b.participant_count ?? 0) / (b.max_participants ?? 256))
    )[0];
  }

  return {
    status: "ok",
    organizationId: org.id,
    campaign: campaignMeta,
    organization: orgMeta,
    group: { id: chosen.id, invite_link: chosen.invite_link, name: chosen.name },
  };
}

// ─── Lead-centric group queries (for LeadInfoDrawer tab) ─────────────────────

export async function getLeadGroups(leadId: string) {
  const { supabase, orgId } = await requireRole("agent");
  const db = supabase as any;

  // Fetch memberships + group data (left_at adicionado na migration 081)
  const { data: memberships, error } = await db
    .from("group_memberships")
    .select("id, group_id, joined_at, left_at, source, utm_source, whatsapp_groups(name)")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .order("joined_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!memberships || memberships.length === 0) return [];

  const groupIds: string[] = memberships.map((m: any) => m.group_id as string);
  const joinedAts: string[] = memberships.map((m: any) => m.joined_at as string);

  // Fetch campaign names via group_campaigns join on whatsapp_groups
  const { data: groupsWithCampaign } = await db
    .from("whatsapp_groups")
    .select("id, campaign_id, group_campaigns(name)")
    .in("id", groupIds)
    .eq("organization_id", orgId);

  const campaignByGroup = new Map<string, string | null>();
  for (const g of (groupsWithCampaign || []) as any[]) {
    campaignByGroup.set(g.id as string, (g.group_campaigns as { name?: string } | null)?.name ?? null);
  }

  // Fetch message stats — single RPC instead of N queries (migration 080)
  const { data: statsRows } = await db.rpc("get_group_message_stats", {
    p_org_id: orgId,
    p_group_ids: groupIds,
    p_joined_ats: joinedAts,
  });

  const messageStats = new Map<string, { count: number; last_message: string | null; last_message_at: string | null }>();
  for (const row of (statsRows || []) as any[]) {
    messageStats.set(row.group_id as string, {
      count: Number(row.message_count ?? 0),
      last_message: (row.last_message as string | null) ?? null,
      last_message_at: (row.last_message_at as string | null) ?? null,
    });
  }

  return (memberships as any[]).map((m) => {
    const stats = messageStats.get(m.group_id as string) ?? { count: 0, last_message: null, last_message_at: null };
    return {
      id: m.id as string,
      group_id: m.group_id as string,
      group_name: (m.whatsapp_groups as { name?: string } | null)?.name ?? "Grupo",
      campaign_name: campaignByGroup.get(m.group_id as string) ?? null,
      joined_at: m.joined_at as string,
      left_at: (m.left_at as string | null) ?? null,
      source: (m.source as "smart_link" | "manual" | "webhook") || "manual",
      utm_source: m.utm_source as string | null,
      message_count: stats.count,
      last_message: stats.last_message,
      last_message_at: stats.last_message_at,
    };
  });
}

export async function removeLeadFromGroup(membershipId: string) {
  const { supabase, orgId } = await requireRole("agent");
  const db = supabase as any;

  // Fetch membership to get group info + phone
  const { data: membership } = await db
    .from("group_memberships")
    .select("group_id, phone, whatsapp_groups(group_jid)")
    .eq("id", membershipId)
    .eq("organization_id", orgId)
    .single();

  if (!membership) throw new Error("Participação não encontrada");

  // Try to remove from WhatsApp group (best-effort — don't fail if UAZAPI unavailable)
  if (membership.phone && (membership.whatsapp_groups as any)?.group_jid) {
    try {
      const provider = await getProvider(supabase, orgId);
      const phone = (membership.phone as string).replace(/\D/g, "");
      await provider.updateGroupParticipants(
        (membership.whatsapp_groups as any).group_jid,
        "remove",
        [phone]
      );
    } catch {
      // UAZAPI call failed — still remove from DB
    }
  }

  const { error } = await db
    .from("group_memberships")
    .delete()
    .eq("id", membershipId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);

  // Decrement participant_count now that the member was removed
  const groupId = (membership as any).group_id as string | undefined;
  if (groupId) {
    await db
      .rpc("decrement_group_participant_count", { p_group_id: groupId })
      .catch((err: unknown) => {
        console.error("[removeLeadFromGroup] decrement_group_participant_count falhou:", err);
      });
  }

  return { success: true };
}

export async function recordGroupJoin(input: {
  organizationId: string;
  groupId: string;
  campaignId: string;
  phone?: string;
  name?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}) {
  const adminClient = createAdminClient();
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "";
  const ipHash = ip ? createHash("sha256").update(ip).digest("hex") : null;

  // Normalize phone using the shared pipeline helper (handles 9° dígito)
  const phone = input.phone ? normalizePhoneBR(input.phone) : null;

  // Fetch group name for activity description
  const db = adminClient as any;
  const { data: group } = await db
    .from("whatsapp_groups")
    .select("name")
    .eq("id", input.groupId)
    .maybeSingle();

  // Verifica se já é membro ativo ANTES do upsert para evitar duplo-incremento
  // (mesma pessoa clicando o link duas vezes → upsert só atualiza, não insere).
  let isActiveMember = false;
  if (phone) {
    const { data: existing } = await db
      .from("group_memberships")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("group_id", input.groupId)
      .eq("phone", phone)
      .is("left_at", null)
      .maybeSingle();
    isActiveMember = Boolean(existing);
  }

  await linkGroupMembership({
    supabase: adminClient,
    orgId: input.organizationId,
    groupId: input.groupId,
    groupName: (group?.name as string | null) ?? "Grupo",
    participantJid: phone ?? input.phone ?? "",
    participantName: input.name?.trim() || null,
    source: "smart_link",
    campaignId: input.campaignId,
    ipHash,
    utm: {
      source: input.utmSource ?? null,
      medium: input.utmMedium ?? null,
      campaign: input.utmCampaign ?? null,
      content: input.utmContent ?? null,
      term: input.utmTerm ?? null,
    },
  });

  // Incrementa participant_count só para entradas novas (RPC migration 080).
  // Revisitas (upsert atualiza row existente) não contam como nova entrada.
  if (!isActiveMember) {
    await db
      .rpc("increment_group_participant_count", { p_group_id: input.groupId })
      .catch((err: unknown) => {
        console.error("[recordGroupJoin] increment_group_participant_count falhou:", err);
      });
  }
}

// ── getGroupLeadMembers ────────────────────────────────────────────────────────
// Returns active group members with the contact data available in CRM.
// Members linked to leads include full lead details; unlinked members still
// return name/phone/avatar from group_memberships so the chat can open a
// contact panel instead of hiding them.

export interface GroupLeadMember {
  membership_id: string;
  phone: string | null;
  name: string | null;
  avatar_url: string | null;
  joined_at: string | null;
  source: string | null;
  lead_id: string | null;
  lead: null | {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    status: string | null;
    source: string | null;
    created_at: string;
    assigned_to: string | null;
    lead_tags: Array<{ tag_id: string; tags: { id: string; name: string; color: string } | null }>;
  };
}

export async function getGroupLeadMembers(groupId: string): Promise<GroupLeadMember[]> {
  const { supabase, orgId } = await requireRole("agent");
  const db = supabase as any;

  const { data, error } = await db
    .from("group_memberships")
    .select(`
      id,
      phone,
      name,
      avatar_url,
      joined_at,
      source,
      lead_id,
      leads (
        id,
        name,
        phone,
        email,
        avatar_url,
        status,
        source,
        created_at,
        assigned_to,
        lead_tags ( tag_id, tags ( id, name, color ) )
      )
    `)
    .eq("organization_id", orgId)
    .eq("group_id", groupId)
    .is("left_at", null)
    .order("name");

  if (error) {
    console.error("[getGroupLeadMembers] erro:", error);
    return [];
  }

  return ((data as unknown) as Array<{
    id: string;
    phone: string | null;
    name: string | null;
    avatar_url: string | null;
    joined_at: string | null;
    source: string | null;
    lead_id: string | null;
    leads: GroupLeadMember["lead"] | null;
  }>)
    .map((m) => ({
      membership_id: m.id,
      phone: m.phone,
      name: m.name,
      avatar_url: m.avatar_url,
      joined_at: m.joined_at,
      source: m.source,
      lead_id: m.lead_id,
      lead: m.leads ?? null,
    }));
}

// ── backfillGroupMembers ───────────────────────────────────────────────────────
// Escaneia todos os remetentes únicos do histórico de mensagens do grupo e roda
// o pipeline de matching para cada um. Popula group_memberships com leads
// identificados retroativamente.

export async function backfillGroupMembers(groupId: string): Promise<{ processed: number; linked: number; error?: string }> {
  // requireRole valida que o user pertence à org — queries usam adminDb
  // para bypass de RLS (whatsapp_groups e whatsapp_connections exigem admin).
  const { orgId } = await requireRole("agent");
  const adminDb = createAdminClient() as any;

  // Busca grupo (JID + nome) — adminDb para bypass da RLS de whatsapp_groups
  const { data: grp } = await adminDb
    .from("whatsapp_groups")
    .select("id, name, group_jid")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!grp) return { processed: 0, linked: 0, error: "Grupo não encontrado" };

  // Fonte 1: lista de participantes ao vivo via UAZAPI
  let apiParticipants: Array<{ jid: string; name: string | null }> = [];
  try {
    const provider = await getProvider(adminDb, orgId);
    const info = await provider.getGroupInfo(grp.group_jid as string, { force: true });
    // Filtra @lid (IDs internos do WhatsApp — não são telefones reais)
    apiParticipants = (info.participants || [])
      .filter((p: { jid: string }) => p.jid && !p.jid.endsWith("@lid"))
      .map((p: { jid: string }) => ({ jid: p.jid, name: null }));
  } catch (err) {
    console.error("[backfillGroupMembers] getGroupInfo falhou:", err);
  }

  // Fonte 2 (complemento): senders do histórico com sender_jid (migration 084)
  const { data: senders } = await adminDb
    .from("group_messages")
    .select("sender_name, sender_jid")
    .eq("group_id", groupId)
    .eq("organization_id", orgId)
    .eq("direction", "inbound")
    .not("sender_jid", "is", null);

  // Mescla as duas fontes, deduplica por JID
  const seen = new Set<string>(apiParticipants.map((p) => p.jid));
  const participants: Array<{ jid: string; name: string | null }> = [...apiParticipants];

  for (const row of (senders || []) as Array<{ sender_name: string | null; sender_jid: string | null }>) {
    if (!row.sender_jid || seen.has(row.sender_jid)) continue;
    seen.add(row.sender_jid);
    participants.push({ jid: row.sender_jid, name: row.sender_name ?? null });
  }

  if (participants.length === 0) {
    return { processed: 0, linked: 0, error: "Nenhum participante encontrado" };
  }

  let linked = 0;
  await Promise.all(
    participants.map(async ({ jid, name }) => {
      const result = await linkGroupMembership({
        supabase: createAdminClient(),
        orgId,
        groupId,
        groupName: grp.name as string,
        participantJid: jid,
        participantName: name,
        source: "webhook",
      }).catch((err: unknown) => {
        console.error("[backfillGroupMembers] linkGroupMembership falhou para", jid, err);
        return null;
      });
      if (result?.lead) linked++;
    })
  );

  return { processed: participants.length, linked };
}

// ── createLeadFromParticipant ─────────────────────────────────────────────────
// Etapa 5: cria (ou vincula) lead a partir de participante sem lead identificado.
// Deduplicado por telefone + variantes BR com/sem 9° dígito.
// Idempotente: se lead ja existir por telefone, apenas vincula a membership.
export async function createLeadFromParticipant(
  groupId: string,
  participant: {
    rawJid: string;
    phone: string;
    displayName?: string | null;
  },
): Promise<{ leadId: string; created: boolean }> {
  const { orgId } = await requireRole("agent");
  const adminDb = createAdminClient() as any;

  const normalized = normalizePhoneBR(participant.phone);
  if (!normalized) throw new Error("Telefone inválido para criar lead");

  const variants = generatePhoneVariants(normalized);

  // 1. Buscar lead existente por telefone (com variantes do 9° dígito)
  const { data: existing } = await adminDb
    .from("leads")
    .select("id")
    .eq("organization_id", orgId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();

  let leadId: string;
  let created: boolean;

  if (existing) {
    leadId = (existing as { id: string }).id;
    created = false;
  } else {
    // 2. Criar lead novo com source = "whatsapp_group"
    const { data: newLead, error } = await adminDb
      .from("leads")
      .insert({
        organization_id: orgId,
        phone: normalized,
        name: participant.displayName?.trim() || null,
        source: "whatsapp_group",
        status: "new",
        channel: "whatsapp",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    leadId = (newLead as { id: string }).id;
    created = true;
  }

  // 3. Buscar nome do grupo para o membership
  const { data: group } = await adminDb
    .from("whatsapp_groups")
    .select("name")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .maybeSingle();

  // 4. Upsert membership vinculando o lead (idempotente por org+group+phone)
  await linkGroupMembership({
    supabase: createAdminClient(),
    orgId,
    groupId,
    groupName: (group?.name as string | null) ?? "Grupo",
    participantJid: participant.rawJid,
    participantName: participant.displayName?.trim() || null,
    source: "manual",
  }).catch((err: unknown) => {
    console.error("[createLeadFromParticipant] linkGroupMembership falhou:", err);
  });

  revalidatePath("/crm");
  return { leadId, created };
}

// ── Etapa 8: Automações de Grupo ──────────────────────────────────────────────

export type GroupAutomationTrigger =
  | "member_joined"
  | "member_left"
  | "lead_identified"
  | "message_received";

export interface GroupAutomation {
  id: string;
  group_id: string;
  trigger: GroupAutomationTrigger;
  action_type: "add_tag";
  action_payload: Record<string, string>;
  is_active: boolean;
  created_at: string;
}

export async function getGroupAutomations(groupId: string): Promise<GroupAutomation[]> {
  const { supabase } = await requireRole("agent");
  const adminDb = createAdminClient() as any;

  // Verify caller has access to this group
  const { data: grp } = await supabase
    .from("whatsapp_groups")
    .select("id")
    .eq("id", groupId)
    .maybeSingle();
  if (!grp) throw new Error("Grupo não encontrado ou sem permissão");

  const { data } = await adminDb
    .from("group_automations")
    .select("id, group_id, trigger, action_type, action_payload, is_active, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });

  return (data ?? []) as GroupAutomation[];
}

export async function upsertGroupAutomation(input: {
  groupId: string;
  trigger: GroupAutomationTrigger;
  action_type: "add_tag";
  action_payload: Record<string, string>;
  is_active?: boolean;
}): Promise<{ id: string }> {
  const { orgId } = await requireRole("agent");
  const adminDb = createAdminClient() as any;

  // Verify group belongs to org
  const { data: grp } = await adminDb
    .from("whatsapp_groups")
    .select("id")
    .eq("id", input.groupId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!grp) throw new Error("Grupo não encontrado");

  const { data, error } = await adminDb
    .from("group_automations")
    .insert({
      organization_id: orgId,
      group_id: input.groupId,
      trigger: input.trigger,
      action_type: input.action_type,
      action_payload: input.action_payload,
      is_active: input.is_active ?? true,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/crm");
  return { id: data.id };
}

export async function deleteGroupAutomation(automationId: string): Promise<void> {
  const { orgId } = await requireRole("agent");
  const adminDb = createAdminClient() as any;

  // Verify ownership
  const { data: auto } = await adminDb
    .from("group_automations")
    .select("id, organization_id")
    .eq("id", automationId)
    .maybeSingle();
  if (!auto || auto.organization_id !== orgId) throw new Error("Automação não encontrada");

  await adminDb.from("group_automations").delete().eq("id", automationId);
  revalidatePath("/crm");
}

// runGroupAutomations — chamado fire-and-forget do webhook.
// Usa admin client para acessar group_automation_logs (sem RLS pública).
export async function runGroupAutomations(
  orgId: string,
  groupId: string,
  trigger: GroupAutomationTrigger,
  eventKey: string,
  context: { leadId?: string; phone?: string; jid?: string },
): Promise<void> {
  const adminDb = createAdminClient() as any;

  const { data: automations } = await adminDb
    .from("group_automations")
    .select("id, action_type, action_payload")
    .eq("organization_id", orgId)
    .eq("group_id", groupId)
    .eq("trigger", trigger)
    .eq("is_active", true);

  if (!automations || automations.length === 0) return;

  await Promise.allSettled(
    automations.map(async (auto: any) => {
      // Idempotency: try to insert log; if UNIQUE violation → already ran → skip
      const { error: logErr } = await adminDb
        .from("group_automation_logs")
        .insert({ automation_id: auto.id, event_key: eventKey });
      if (logErr) return; // duplicate key = skip

      if (auto.action_type === "add_tag" && context.leadId && auto.action_payload?.tag_id) {
        const { addTagToLead } = await import("@persia/shared/crm");
        await addTagToLead({ db: adminDb, orgId }, context.leadId, auto.action_payload.tag_id);
      }
    }),
  );
}

// ── bulkAddTagToGroupLeads ─────────────────────────────────────────────────────
// Etapa 6: aplica uma tag em massa a múltiplos leads de um grupo.
// Usa Promise.allSettled para não abortar ao primeiro erro.
export async function bulkAddTagToGroupLeads(
  leadIds: string[],
  tagId: string,
): Promise<{ success: number; failed: number }> {
  const { supabase, orgId } = await requireRole("agent");
  const { addTagToLead: addTagShared } = await import("@persia/shared/crm");

  const results = await Promise.allSettled(
    leadIds.map((leadId) =>
      addTagShared({ db: supabase, orgId }, leadId, tagId),
    ),
  );

  const success = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  if (success > 0) revalidatePath("/crm");
  return { success, failed };
}

// ── Etapa 7: Backfill controlado de avatares ───────────────────────────────────

export interface BackfillAvatarsResult {
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
}

// Preenche avatar_url de membros ativos sem avatar (lote máximo 30 para não
// sobrecarregar UAZAPI). Respeita cache: pula membros com avatar_fetched_at
// recente (< 24h) para evitar rate limit.
export async function backfillGroupParticipantAvatars(
  groupId: string,
): Promise<BackfillAvatarsResult> {
  const { orgId } = await requireRole("admin");
  const admin = createAdminClient() as any;
  const supabase = (await requireRole("admin")).supabase;

  // Verificar que o grupo pertence à org
  const { data: grp } = await supabase
    .from("whatsapp_groups")
    .select("id")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!grp) throw new Error("Grupo não encontrado");

  // Membros ativos sem avatar ou com avatar buscado há mais de 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: members } = await admin
    .from("group_memberships")
    .select("id, phone, lead_id, avatar_url, avatar_fetched_at")
    .eq("group_id", groupId)
    .eq("organization_id", orgId)
    .is("left_at", null)
    .or(`avatar_url.is.null,avatar_fetched_at.lt.${cutoff}`)
    .limit(30);

  if (!members || members.length === 0) return { processed: 0, updated: 0, skipped: 0, failed: 0 };

  // Precisa do provider
  const { supabase: supabaseForProvider } = await requireRole("admin");
  const provider = await getProvider(supabaseForProvider, orgId);

  const { getAndCacheContactAvatar } = await import("@/lib/lead-avatar-cache");

  let updated = 0, skipped = 0, failed = 0;

  await Promise.allSettled(
    (members as any[]).map(async (m) => {
      if (!m.phone) { skipped++; return; }
      try {
        const { avatarUrl, updated: wasUpdated } = await getAndCacheContactAvatar({
          organizationId: orgId,
          leadId: m.lead_id ?? null,
          phone: m.phone,
          currentAvatarUrl: m.avatar_url,
          provider,
        });
        if (wasUpdated || (avatarUrl && avatarUrl !== m.avatar_url)) {
          await admin
            .from("group_memberships")
            .update({ avatar_url: avatarUrl, avatar_fetched_at: new Date().toISOString() })
            .eq("id", m.id);
          updated++;
        } else {
          // Atualizar apenas o timestamp para não reprocessar na próxima rodada
          await admin
            .from("group_memberships")
            .update({ avatar_fetched_at: new Date().toISOString() })
            .eq("id", m.id);
          skipped++;
        }
      } catch {
        failed++;
      }
    }),
  );

  return { processed: members.length, updated, skipped, failed };
}

// Busca foto de todos os grupos da org sem imagem ou com imagem desatualizada.
export async function syncGroupImages(): Promise<BackfillAvatarsResult> {
  const { supabase, orgId } = await requireRole("admin");
  const admin = createAdminClient() as any;

  const { data: groups } = await admin
    .from("whatsapp_groups")
    .select("id, group_jid, image_url, image_fetched_at")
    .eq("organization_id", orgId)
    .or("image_url.is.null,image_fetched_at.is.null")
    .limit(20);

  if (!groups || groups.length === 0) return { processed: 0, updated: 0, skipped: 0, failed: 0 };

  const provider = await getProvider(supabase, orgId);
  const { cacheGroupAvatarFromUrl } = await import("@/lib/lead-avatar-cache");

  let updated = 0, skipped = 0, failed = 0;

  await Promise.allSettled(
    (groups as any[]).map(async (g) => {
      try {
        const remoteImageUrl = await getRemoteChatImageUrl(provider, g.group_jid);
        if (!remoteImageUrl) {
          await admin
            .from("whatsapp_groups")
            .update({ image_fetched_at: new Date().toISOString() })
            .eq("id", g.id);
          skipped++;
          return;
        }
        const cached = await cacheGroupAvatarFromUrl({
          organizationId: orgId,
          groupId: g.id,
          remoteUrl: remoteImageUrl,
          currentImageUrl: g.image_url,
        });
        if (cached && cached !== g.image_url) updated++;
        else skipped++;
      } catch {
        failed++;
      }
    }),
  );

  revalidatePath("/crm");
  return { processed: groups.length, updated, skipped, failed };
}
