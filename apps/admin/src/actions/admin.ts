"use server";

import { requireSuperadmin, requireSuperadminWithUser } from "@/lib/auth";
import { setAdminContext, clearAdminContext, readAdminContext } from "@/lib/admin-context";
import { auditFailure, auditLog } from "@/lib/audit";
import { assertRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";

// ============ ADMIN CONTEXT ============

/**
 * Switch the server-side admin context to a target org.
 * Sets a signed HttpOnly cookie with the orgId + userId + TTL.
 * Must be called BEFORE the frontend updates Zustand.
 */
export async function switchAdminContext(orgId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId } = await requireSuperadminWithUser(orgId);
    // orgId validated by requireSuperadminWithUser(orgId) — confirms org exists

    await setAdminContext(orgId, userId);

    await auditLog({
      userId,
      orgId,
      action: "switch_context",
      entityType: "organization",
      entityId: orgId,
    });

    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : "Erro ao trocar contexto" };
  }
}

/**
 * Clear the server-side admin context (return to admin org).
 * Deletes the admin-context cookie. Only logs audit if a context was active.
 */
export async function clearAdminContextAction(): Promise<void> {
  try {
    const { userId } = await requireSuperadminWithUser();
    // Only log if there was an active context to clear
    const ctx = await readAdminContext();
    await clearAdminContext();
    if (ctx) {
      await auditLog({ userId, orgId: ctx.orgId, action: "clear_context", entityType: "organization", entityId: ctx.orgId });
    }
  } catch {
    // Best effort — clearing context should not fail
    await clearAdminContext();
  }
}

export async function getOrCreateAdminOrg(): Promise<{ id: string; name: string }> {
  const admin = await requireSuperadmin();

  // Check env first
  const envOrgId = process.env.NEXT_PUBLIC_ADMIN_ORG_ID;
  if (envOrgId) {
    const { data } = await admin.from("organizations").select("id, name").eq("id", envOrgId).single();
    if (data) return data;
  }

  // Look for existing admin org by slug
  const { data: existing } = await admin
    .from("organizations")
    .select("id, name")
    .eq("slug", "admin-persia")
    .single();
  if (existing) return existing;

  // Create admin org
  const { data: newOrg, error } = await admin
    .from("organizations")
    .insert({
      name: "Admin Persia",
      slug: "admin-persia",
      plan: "enterprise",
      category: "admin",
      services: { chat: true, crm: true, leads: true, groups: true, automations: true, campaigns: true, reports: true },
    })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  return newOrg!;
}

export async function getAdminStats() {
  const admin = await requireSuperadmin();
  const [orgs, leads, conversations, assistants] = await Promise.all([
    admin.from("organizations").select("*", { count: "exact", head: true }),
    admin.from("leads").select("*", { count: "exact", head: true }),
    admin.from("conversations").select("*", { count: "exact", head: true }),
    admin.from("ai_assistants").select("*", { count: "exact", head: true }),
  ]);
  return {
    organizations: orgs.count || 0,
    leads: leads.count || 0,
    conversations: conversations.count || 0,
    assistants: assistants.count || 0,
  };
}

export async function getOrganizations() {
  const admin = await requireSuperadmin();
  const { data } = await admin.from("organizations").select("id, name, slug, category, plan, logo_url, services, created_at, organization_members(count)").order("created_at", { ascending: false }).limit(200);
  return data || [];
}

export async function getOrganizationDetail(orgId: string) {
  const admin = await requireSuperadmin();

  const { data: org } = await admin.from("organizations").select("*").eq("id", orgId).single();
  if (!org) throw new Error("Nao encontrada");

  const { data: members } = await admin
    .from("organization_members")
    .select("id, user_id, role, is_active, created_at, profiles(full_name, phone)")
    .eq("organization_id", orgId)
    .order("created_at");

  // Batch fetch auth users (instead of N+1 getUserById calls)
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  if (authData?.users) {
    for (const u of authData.users) emailMap.set(u.id, u.email || "");
  }

  const enrichedMembers = (members || []).map((m) => {
    const profile = (m as Record<string, unknown> & { profiles?: { full_name?: string | null } }).profiles;
    return {
      ...m,
      email: emailMap.get(m.user_id) || "",
      name: profile?.full_name || "Sem nome",
    };
  });

  const [leads, conversations, connections] = await Promise.all([
    admin.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("conversations").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("whatsapp_connections").select("*").eq("organization_id", orgId).limit(1).single(),
  ]);

  return {
    org,
    members: enrichedMembers,
    stats: { leads: leads.count || 0, conversations: conversations.count || 0, whatsappStatus: connections.data?.status || "not_configured", whatsappPhone: connections.data?.phone_number || null },
    whatsapp: connections.data ? { instanceUrl: connections.data.instance_url || "", instanceToken: connections.data.instance_token || "", phoneNumber: connections.data.phone_number || "", status: connections.data.status || "" } : null,
  };
}

export async function createOrganization(data: {
  name: string; email: string; password: string; phone?: string; ownerName?: string; niche?: string; category?: string; cpfCnpj?: string; services?: Record<string, boolean>;
}) {
  const { admin, userId: superadminId } = await requireSuperadminWithUser();

  const { data: newUser, error: authErr } = await admin.auth.admin.createUser({
    email: data.email, password: data.password, email_confirm: true,
    user_metadata: { full_name: data.ownerName || data.name, phone: data.phone },
  });
  if (authErr) throw new Error(authErr.message.includes("already been registered") ? "Email ja cadastrado" : authErr.message);

  const newUserId = newUser.user!.id;
  await admin.from("profiles").upsert({ id: newUserId, full_name: data.ownerName || data.name, phone: data.phone || null });

  const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const { data: org, error: orgErr } = await admin.from("organizations").insert({
    name: data.name, slug, niche: data.niche || null, category: data.category || "empresa", cpf_cnpj: data.cpfCnpj || null,
    plan: "trial", services: data.services || { chat: true, crm: true, leads: true, groups: true, automations: true, campaigns: false, reports: true },
  }).select().single();
  if (orgErr) throw new Error(orgErr.message);

  await admin.from("organization_members").insert({ user_id: newUserId, organization_id: org.id, role: "owner", is_active: true });
  await auditLog({ userId: superadminId, orgId: org.id, action: "create_organization", entityType: "organization", entityId: org.id, metadata: { name: data.name, email: data.email } });
  revalidatePath("/clients");
  return org;
}

export async function updateOrganization(orgId: string, data: Record<string, unknown>) {
  const { admin, userId } = await requireSuperadminWithUser(orgId);
  const { error } = await admin.from("organizations").update({ ...data, updated_at: new Date().toISOString() }).eq("id", orgId);
  if (error) throw new Error(error.message);
  await auditLog({ userId, orgId, action: "update_organization", entityType: "organization", entityId: orgId, metadata: data });
  revalidatePath("/clients");
}

export async function deleteOrganization(orgId: string) {
  const { admin, userId } = await requireSuperadminWithUser(orgId);
  try {
    await assertRateLimit({ admin, userId, orgId, action: "delete_organization" });
  } catch (error) {
    await auditFailure({
      userId,
      orgId,
      action: "delete_organization",
      entityType: "organization",
      entityId: orgId,
      metadata: { reason: "rate_limit" },
      error,
    });
    throw error;
  }

  const { error } = await admin.from("organizations").delete().eq("id", orgId);
  if (error) throw new Error(error.message);
  await auditLog({ userId, orgId, action: "delete_organization", entityType: "organization", entityId: orgId });
  revalidatePath("/clients");
}

// ============ AUDIT LOG ============

export interface AuditLogRow {
  id: string;
  created_at: string | null;
  user_id: string;
  user_email: string;
  user_name: string;
  target_org_id: string | null;
  target_org_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  result: string | null;
  error_msg: string | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
}

export interface AuditLogFilters {
  action?: string;
  orgId?: string;
  userId?: string;
  result?: string;
  since?: string; // ISO date
  until?: string; // ISO date
  limit?: number;
  offset?: number;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function getAuditLogs(filters: AuditLogFilters = {}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const admin = await requireSuperadmin();
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  let query = admin
    .from("admin_audit_log")
    .select("id, created_at, user_id, target_org_id, action, entity_type, entity_id, metadata, result, error_msg, request_id, ip, user_agent", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.orgId) query = query.eq("target_org_id", filters.orgId);
  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.result) query = query.eq("result", filters.result);
  if (filters.since) query = query.gte("created_at", filters.since);
  if (filters.until) query = query.lte("created_at", filters.until);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const rawRows = data || [];
  if (rawRows.length === 0) return { rows: [], total: count || 0 };

  // Collect unique user and org IDs for batch lookup
  const userIds = Array.from(new Set(rawRows.map((r) => r.user_id)));
  const orgIds = Array.from(new Set(rawRows.map((r) => r.target_org_id).filter((v): v is string => !!v)));

  const [profilesRes, orgsRes, authRes] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", userIds),
    orgIds.length > 0
      ? admin.from("organizations").select("id, name").in("id", orgIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const nameMap = new Map<string, string>();
  for (const p of profilesRes.data || []) nameMap.set(p.id, p.full_name || "");

  const emailMap = new Map<string, string>();
  if (authRes.data?.users) {
    for (const u of authRes.data.users) emailMap.set(u.id, u.email || "");
  }

  const orgMap = new Map<string, string>();
  for (const o of orgsRes.data || []) orgMap.set(o.id, o.name);

  const rows: AuditLogRow[] = rawRows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    user_id: r.user_id,
    user_email: emailMap.get(r.user_id) || "",
    user_name: nameMap.get(r.user_id) || "",
    target_org_id: r.target_org_id,
    target_org_name: r.target_org_id ? orgMap.get(r.target_org_id) || null : null,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    metadata: (r.metadata as Record<string, unknown>) || {},
    result: nullableString(r.result),
    error_msg: nullableString(r.error_msg),
    request_id: nullableString(r.request_id),
    ip: nullableString(r.ip),
    user_agent: nullableString(r.user_agent),
  }));

  return { rows, total: count || 0 };
}

export async function getAuditFilterOptions(): Promise<{
  actions: string[];
  orgs: Array<{ id: string; name: string }>;
}> {
  const admin = await requireSuperadmin();

  const [actionsRes, orgsRes] = await Promise.all([
    admin.from("admin_audit_log").select("action").limit(5000),
    admin.from("organizations").select("id, name").order("name").limit(500),
  ]);

  const actionSet = new Set<string>();
  for (const r of actionsRes.data || []) actionSet.add(r.action);

  return {
    actions: Array.from(actionSet).sort(),
    orgs: orgsRes.data || [],
  };
}

// ============ WHATSAPP ============

export async function connectWhatsAppInstance(orgId: string, instanceUrl: string, instanceToken: string, phoneNumber?: string) {
  const admin = await requireSuperadmin();
  const { data: existing } = await admin.from("whatsapp_connections").select("id").eq("organization_id", orgId).limit(1).single();

  if (existing) {
    await admin.from("whatsapp_connections").update({ instance_url: instanceUrl, instance_token: instanceToken, phone_number: phoneNumber || null, status: "connected", updated_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await admin.from("whatsapp_connections").insert({ organization_id: orgId, instance_url: instanceUrl, instance_token: instanceToken, phone_number: phoneNumber || null, status: "connected", provider: "uazapi" });
  }
  revalidatePath(`/clients/${orgId}`);
}
