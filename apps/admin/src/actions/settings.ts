"use server";

import { requireSuperadminForOrg, requireSuperadminWithUser } from "@/lib/auth";
import { auditFailure, auditLog } from "@/lib/audit";
import { assertRateLimit } from "@/lib/rate-limit";
import { createProvider } from "@/lib/whatsapp/providers";
import { revalidatePath } from "next/cache";


// ============ ORGANIZATION ============

export async function getOrgSettings() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin.from("organizations").select("*").eq("id", orgId).single();
  if (error) return null;
  return data;
}

export async function updateOrgSettings(updates: { name?: string; niche?: string; services?: Record<string, boolean>; }) {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  // Whitelist explícita — defesa contra raw POST com chaves arbitrárias.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.niche !== undefined) patch.niche = updates.niche;
  if (updates.services !== undefined) patch.services = updates.services;
  const { error } = await admin.from("organizations").update(patch).eq("id", orgId);
  if (error) {
    await auditFailure({ userId, orgId, action: "update_org_settings", entityType: "organization", entityId: orgId, error });
    return { error: error.message };
  }
  await auditLog({ userId, orgId, action: "update_org_settings", entityType: "organization", entityId: orgId });
  revalidatePath("/settings");
  return { error: null };
}

// ============ TEAM ============

export async function getTeamMembers() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: members } = await admin
    .from("organization_members")
    .select("id, user_id, role, is_active, created_at, profiles(full_name, phone)")
    .eq("organization_id", orgId)
    .order("created_at")
    .limit(100);

  if (!members || members.length === 0) return [];

  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  if (authData?.users) {
    for (const u of authData.users) emailMap.set(u.id, u.email || "");
  }

  return members.map((m) => ({
    ...m,
    email: emailMap.get(m.user_id) || "",
    name: (m as Record<string, unknown> & { profiles?: { full_name?: string } }).profiles?.full_name || "Sem nome",
    phone: (m as Record<string, unknown> & { profiles?: { phone?: string } }).profiles?.phone || "",
  }));
}

const ALLOWED_MEMBER_ROLES = ["admin", "agent", "viewer"] as const;

export async function createTeamMember(data: {
  firstName: string; lastName: string; email: string; phone: string; password: string; role: string;
}) {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  if (!(ALLOWED_MEMBER_ROLES as readonly string[]).includes(data.role)) {
    return { error: `Role inválida: ${data.role}` };
  }

  const { data: newUser, error: authErr } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { full_name: `${data.firstName} ${data.lastName}`, phone: data.phone },
  });

  if (authErr) {
    await auditFailure({
      userId,
      orgId,
      action: "create_team_member",
      entityType: "member",
      metadata: { email: data.email, role: data.role },
      error: authErr,
    });
    if (authErr.message.includes("already been registered")) return { error: "Email ja cadastrado" };
    return { error: authErr.message };
  }

  const newUserId = newUser.user!.id;
  await admin.from("profiles").upsert({ id: newUserId, full_name: `${data.firstName} ${data.lastName}`, phone: data.phone });
  const { error } = await admin.from("organization_members").insert({ user_id: newUserId, organization_id: orgId, role: data.role, is_active: true });
  if (error) {
    await auditFailure({
      userId,
      orgId,
      action: "create_team_member",
      entityType: "member",
      entityId: newUserId,
      metadata: { email: data.email, role: data.role },
      error,
    });
    return { error: error.message };
  }

  await auditLog({ userId, orgId, action: "create_team_member", entityType: "member", metadata: { email: data.email, role: data.role } });
  revalidatePath("/settings/team");
  return { error: null };
}

export async function updateMemberRole(memberId: string, role: string) {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  if (!(ALLOWED_MEMBER_ROLES as readonly string[]).includes(role)) {
    return { error: `Role inválida: ${role}` };
  }
  const { error } = await admin.from("organization_members").update({ role }).eq("id", memberId).eq("organization_id", orgId);
  if (error) {
    await auditFailure({ userId, orgId, action: "update_member_role", entityType: "member", entityId: memberId, metadata: { role }, error });
    return { error: error.message };
  }
  await auditLog({ userId, orgId, action: "update_member_role", entityType: "member", entityId: memberId, metadata: { role } });
  revalidatePath("/settings/team");
  return { error: null };
}

export async function toggleMemberActive(memberId: string) {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  // Verify member belongs to active org
  const { data: member } = await admin.from("organization_members").select("is_active, role").eq("id", memberId).eq("organization_id", orgId).single();
  if (!member) return { error: "Membro nao encontrado nesta organizacao" };
  if (member.role === "owner") return { error: "Nao pode desativar o dono" };

  const { error } = await admin.from("organization_members").update({ is_active: !member.is_active }).eq("id", memberId).eq("organization_id", orgId);
  if (error) {
    await auditFailure({ userId, orgId, action: "toggle_member_active", entityType: "member", entityId: memberId, error });
    return { error: error.message };
  }
  await auditLog({ userId, orgId, action: "toggle_member_active", entityType: "member", entityId: memberId });
  revalidatePath("/settings/team");
  return { error: null };
}

// ============ QUEUES ============

export async function getQueues() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: queues } = await admin.from("queues").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
  if (!queues || queues.length === 0) return [];

  const queueIds = queues.map((q) => q.id);
  const { data: members } = await admin.from("queue_members").select("queue_id").in("queue_id", queueIds);
  const countMap: Record<string, number> = {};
  (members || []).forEach((m) => { countMap[m.queue_id] = (countMap[m.queue_id] || 0) + 1; });

  return queues.map((q) => ({ ...q, member_count: countMap[q.id] || 0 }));
}

export async function createQueue(data: { name: string; description?: string; distribution_type: string }) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: queue, error } = await admin.from("queues").insert({
    organization_id: orgId, name: data.name, description: data.description || null, distribution_type: data.distribution_type,
  }).select().single();
  if (error) return { data: null, error: error.message };
  revalidatePath("/settings/queues");
  return { data: queue, error: null };
}

export async function updateQueue(queueId: string, data: Record<string, unknown>) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin.from("queues").update(data).eq("id", queueId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings/queues");
  return { error: null };
}

export async function deleteQueue(queueId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();

  // Guard: não deletar fila com conversas ativas (evita FK violation + orphans)
  const { count: activeConversations } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("queue_id", queueId)
    .eq("organization_id", orgId);
  if ((activeConversations ?? 0) > 0) {
    return { error: `Não é possível excluir: ${activeConversations} conversa(s) ativa(s) nesta fila. Mova-as primeiro.` };
  }

  await admin.from("queue_members").delete().eq("queue_id", queueId).eq("organization_id", orgId);
  const { error } = await admin.from("queues").delete().eq("id", queueId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings/queues");
  return { error: null };
}

// ============ WEBHOOKS ============

export async function getWebhooks() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin.from("webhooks").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
  return data || [];
}

export async function createWebhook(data: { name: string; direction: string; url?: string; events?: string }) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const events = data.events ? data.events.split(",").map(e => e.trim()).filter(Boolean) : [];
  const token = data.direction === "inbound" ? crypto.randomUUID().replace(/-/g, "") : null;

  const { data: webhook, error } = await admin.from("webhooks").insert({
    organization_id: orgId, name: data.name, direction: data.direction, url: data.url || null, token, events, is_active: true,
  }).select().single();
  if (error) return { data: null, error: error.message };
  revalidatePath("/settings/webhooks");
  return { data: webhook, error: null };
}

export async function toggleWebhookActive(webhookId: string, isActive: boolean) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin.from("webhooks").update({ is_active: isActive }).eq("id", webhookId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings/webhooks");
  return { error: null };
}

export async function deleteWebhook(webhookId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin.from("webhooks").delete().eq("id", webhookId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings/webhooks");
  return { error: null };
}

// ============ AI ASSISTANTS ============

export async function getAssistants() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await admin.from("ai_assistants").select("*").eq("organization_id", orgId).order("created_at");
  return data || [];
}

export async function createAssistant(data: {
  name: string; prompt: string; category?: string; tone?: string;
  welcome_msg?: string; off_hours_msg?: string; schedule?: Record<string, unknown>;
}) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: assistant, error } = await admin.from("ai_assistants").insert({
    organization_id: orgId,
    name: data.name,
    prompt: data.prompt,
    category: data.category || "geral",
    tone: data.tone || "amigavel",
    welcome_msg: data.welcome_msg || null,
    off_hours_msg: data.off_hours_msg || null,
    schedule: data.schedule || { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
    model: "gpt-4.1-mini",
    is_active: true,
    message_splitting: { enabled: false, threshold: 100, delay_seconds: 2 },
  } as never).select().single();
  if (error) return { data: null, error: error.message };
  revalidatePath("/settings/ai");
  revalidatePath("/automations/assistant");
  return { data: assistant, error: null };
}

const ASSISTANT_ALLOWED_FIELDS = ["name", "prompt", "category", "tone", "welcome_msg", "off_hours_msg", "schedule", "model", "is_active", "message_splitting"] as const;

export async function updateAssistant(assistantId: string, data: Record<string, unknown>) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Whitelist — previne mass assignment (ex: organization_id sobrescrição)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ASSISTANT_ALLOWED_FIELDS) {
    if (key in data) patch[key] = data[key];
  }
  const { error } = await admin.from("ai_assistants").update(patch).eq("id", assistantId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings/ai");
  revalidatePath("/automations/assistant");
  return { error: null };
}

export async function toggleAssistant(assistantId: string, isActive: boolean) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin.from("ai_assistants").update({ is_active: isActive }).eq("id", assistantId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings/ai");
  revalidatePath("/automations/assistant");
  return { error: null };
}

export async function deleteAssistant(assistantId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin.from("ai_assistants").delete().eq("id", assistantId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings/ai");
  revalidatePath("/automations/assistant");
  return { error: null };
}

// ============ API KEYS ============

export async function listApiKeys() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data } = await (admin as any)
    .from('api_keys')
    .select('id, name, key_prefix, is_active, created_at, last_used_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function revokeApiKey(keyId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await (admin as any)
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', keyId)
    .eq('organization_id', orgId);
  if (error) return { error: error.message };
  revalidatePath('/settings/api-keys');
  return { error: null };
}

// ============ GOOGLE CALENDAR ============

export async function getGoogleCalendarStatus() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await (admin as any)
    .from('google_calendar_connections')
    .select('id, email, is_active, calendar_id, created_at, updated_at')
    .eq('organization_id', orgId)
    .limit(1)
    .maybeSingle();
  if (error && !/could not find the table/i.test(error.message)) return null;
  return data ?? null;
}

// ============ MCP SERVERS ============

export async function listMcpServersAdmin() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await (admin as any)
    .from('mcp_server_connections')
    .select('id, name, server_url, is_active, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });
  if (error && /could not find the table/i.test(error.message)) return [];
  return data ?? [];
}

export async function deleteMcpServer(serverId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await (admin as any)
    .from('mcp_server_connections')
    .delete()
    .eq('id', serverId)
    .eq('organization_id', orgId);
  if (error) return { error: error.message };
  revalidatePath('/settings/mcp-servers');
  return { error: null };
}

export async function toggleMcpServer(serverId: string, isActive: boolean) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await (admin as any)
    .from('mcp_server_connections')
    .update({ is_active: isActive })
    .eq('id', serverId)
    .eq('organization_id', orgId);
  if (error) return { error: error.message };
  revalidatePath('/settings/mcp-servers');
  return { error: null };
}

// ============ CAPTURE SOURCES ============

export async function listCaptureSourcesAdmin() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await (admin as any)
    .from('capture_sources')
    .select('id, name, slug, is_active, pipeline_id, stage_id, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });
  if (error && /could not find the table/i.test(error.message)) return [];
  return data ?? [];
}

// ============ WHATSAPP STATUS ============

/**
 * Get WhatsApp connection status for the active org context.
 * UAZAPI: GET /instance/status (token) — checks connected + loggedIn
 */
export async function getWhatsAppStatus() {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data: connection } = await admin.from("whatsapp_connections").select("id, provider, instance_url, instance_token, phone_number, status").eq("organization_id", orgId).limit(1).single();

  if (!connection) return { status: "not_configured", phone: null };

  try {
    const provider = createProvider(connection);
    const sessionStatus = await provider.getStatus();
    const isConnected = sessionStatus.connected && sessionStatus.loggedIn;

    // Sync DB status with real UAZAPI status
    if (isConnected && connection.status !== "connected") {
      await admin.from("whatsapp_connections")
        .update({ status: "connected", updated_at: new Date().toISOString() })
        .eq("id", connection.id)
        .eq("organization_id", orgId);
    } else if (!isConnected && connection.status === "connected") {
      await admin.from("whatsapp_connections")
        .update({ status: "disconnected", updated_at: new Date().toISOString() })
        .eq("id", connection.id)
        .eq("organization_id", orgId);
    }

    return {
      status: isConnected ? "connected" : "disconnected",
      phone: connection.phone_number,
    };
  } catch {
    return { status: "unreachable", phone: connection.phone_number };
  }
}

// ============ ADMIN GLOBAL (no org context needed) ============

export async function addSuperadmin(email: string) {
  const { admin, userId } = await requireSuperadminWithUser();

  try {
    await assertRateLimit({ admin, userId, action: "add_superadmin" });
  } catch (error) {
    await auditFailure({
      userId,
      orgId: null,
      action: "add_superadmin",
      entityType: "superadmin",
      metadata: { email, reason: "rate_limit" },
      error,
    });
    return { error: error instanceof Error ? error.message : "Muitas tentativas. Tente novamente em instantes." };
  }

  // Find user by email via paginated listUsers (profiles table has no email column).
  let foundId: string | null = null;
  let page = 1;
  while (!foundId) {
    const { data: authData } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    if (!authData?.users?.length) break;
    const match = authData.users.find((u) => u.email === email);
    if (match) { foundId = match.id; break; }
    if (authData.users.length < 50) break;
    page++;
  }
  if (!foundId) return { error: "Usuario nao encontrado com este email" };

  const { data: profile } = await admin.from("profiles").select("is_superadmin").eq("id", foundId).maybeSingle();
  if (profile?.is_superadmin) return { error: "Ja e superadmin" };

  const { error } = await admin.from("profiles").update({ is_superadmin: true }).eq("id", foundId);
  if (error) {
    await auditFailure({ userId, orgId: null, action: "add_superadmin", entityType: "superadmin", entityId: foundId, metadata: { email }, error });
    return { error: error.message };
  }
  await auditLog({ userId, orgId: null, action: "add_superadmin", entityType: "superadmin", metadata: { email } });
  return { error: null };
}

export async function removeSuperadmin(targetUserId: string) {
  const { admin, userId: callerId } = await requireSuperadminWithUser();

  if (callerId === targetUserId) return { error: "Nao pode remover a si mesmo" };

  const { error } = await admin.from("profiles").update({ is_superadmin: false }).eq("id", targetUserId);
  if (error) {
    await auditFailure({ userId: callerId, orgId: null, action: "remove_superadmin", entityType: "superadmin", entityId: targetUserId, error });
    return { error: error.message };
  }
  await auditLog({ userId: callerId, orgId: null, action: "remove_superadmin", entityType: "superadmin", entityId: targetUserId });
  return { error: null };
}

export async function getSuperadmins() {
  const { admin } = await requireSuperadminWithUser();
  const { data: profiles } = await admin.from("profiles").select("id, full_name, phone").eq("is_superadmin", true).limit(50);

  if (!profiles || profiles.length === 0) return [];

  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  if (authData?.users) {
    for (const u of authData.users) emailMap.set(u.id, u.email || "");
  }

  return profiles.map((p) => ({ ...p, email: emailMap.get(p.id) || "" }));
}
