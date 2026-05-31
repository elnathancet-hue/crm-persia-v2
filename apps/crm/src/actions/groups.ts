"use server";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProvider } from "@/lib/whatsapp/providers";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createHash } from "crypto";

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

  // Get memberships linked to leads (table added in migration 079, not in generated types)
  const { data: memberships } = await db
    .from("group_memberships")
    .select("group_id, lead_id")
    .eq("organization_id", orgId)
    .in("group_id", groupIds)
    .not("lead_id", "is", null);

  const allMemberships = (memberships || []) as { group_id: string; lead_id: string }[];

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
  }));
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

  // Fetch memberships + group data
  const { data: memberships, error } = await db
    .from("group_memberships")
    .select("id, group_id, joined_at, source, utm_source, whatsapp_groups(name)")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .order("joined_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!memberships || memberships.length === 0) return [];

  const groupIds: string[] = memberships.map((m: any) => m.group_id as string);

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

  // Fetch message stats per group (inbound messages since lead joined)
  const messageStats = new Map<string, { count: number; last_message: string | null; last_message_at: string | null }>();
  for (const m of memberships as any[]) {
    const { data: msgs, count } = await db
      .from("group_messages")
      .select("text, created_at", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("group_id", m.group_id)
      .eq("direction", "inbound")
      .gte("created_at", m.joined_at)
      .order("created_at", { ascending: false })
      .limit(1);

    messageStats.set(m.group_id as string, {
      count: count ?? 0,
      last_message: (msgs as any[])?.[0]?.text ?? null,
      last_message_at: (msgs as any[])?.[0]?.created_at ?? null,
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
  const db = createAdminClient() as any;
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "";
  const ipHash = ip ? createHash("sha256").update(ip).digest("hex") : null;

  // Normalize phone (remove non-digits, add +55 if BR 10-11 digit)
  let phone: string | null = null;
  if (input.phone) {
    const digits = input.phone.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) {
      phone = `+${digits}`;
    } else if (digits.length >= 10 && digits.length <= 11) {
      phone = `+55${digits}`;
    } else if (digits.length > 0) {
      phone = `+${digits}`;
    }
  }

  // Upsert membership (ON CONFLICT on phone+group → update joined_at)
  await db.from("group_memberships").upsert(
    {
      organization_id: input.organizationId,
      group_id: input.groupId,
      campaign_id: input.campaignId,
      phone,
      name: input.name?.trim() || null,
      joined_at: new Date().toISOString(),
      source: "smart_link",
      utm_source: input.utmSource || null,
      utm_medium: input.utmMedium || null,
      utm_campaign: input.utmCampaign || null,
      utm_content: input.utmContent || null,
      utm_term: input.utmTerm || null,
      ip_hash: ipHash,
    },
    { onConflict: "organization_id,group_id,phone", ignoreDuplicates: false }
  );

  // Link to existing lead if phone matches
  if (phone) {
    const { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("phone", phone)
      .maybeSingle();
    if (lead) {
      await db
        .from("group_memberships")
        .update({ lead_id: lead.id })
        .eq("organization_id", input.organizationId)
        .eq("group_id", input.groupId)
        .eq("phone", phone);
    }
  }

  // Increment participant_count optimistically
  await db.rpc("increment_group_participant_count", { p_group_id: input.groupId }).catch(() => {
    // RPC optional — participant_count also updated on sync
  });
}
