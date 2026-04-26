"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { LeadFilters, LeadWithTags } from "@persia/shared/crm";

// Re-exporta tipos canônicos. Admin não usa whatsapp_id/opt_in/metadata
// (são opcionais no tipo shared), então as queries existentes continuam
// compatíveis.
export type { LeadFilters, LeadWithTags };

export async function getLeads(filters: LeadFilters = {}) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { search, status, tags, page = 1, limit = 20 } = filters;
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  let leadIdsFromTags: string[] | null = null;

  if (tags && tags.length > 0) {
    const { data: taggedLeads, error: tagError } = await admin
      .from("lead_tags")
      .select("lead_id")
      .eq("organization_id", orgId)
      .in("tag_id", tags);

    if (tagError) return { data: null, error: tagError.message, count: 0 };

    leadIdsFromTags = Array.from(
      new Set((taggedLeads || []).map((row) => row.lead_id).filter(Boolean))
    );

    if (leadIdsFromTags.length === 0) {
      return { data: [], error: null, count: 0 };
    }
  }

  let query = admin
    .from("leads")
    .select(`*, lead_tags(tag_id, tags(id, name, color))`, { count: "exact" })
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    const sanitized = search.replace(/[%_,()\\]/g, "").trim();
    if (sanitized) {
      query = query.or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%,email.ilike.%${sanitized}%`);
    }
  }
  if (status) query = query.eq("status", status);
  if (leadIdsFromTags) query = query.in("id", leadIdsFromTags);

  const { data, error, count } = await query;
  if (error) return { data: null, error: error.message, count: 0 };
  return { data: data as LeadWithTags[], error: null, count: count || 0 };
}

export async function getLeadDetail(leadId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { data, error } = await admin
    .from("leads")
    .select(`*, lead_tags(tag_id, tags(id, name, color)), lead_custom_field_values(id, custom_field_id, value, custom_fields(id, name, field_type))`)
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function createLead(data: { name: string; phone?: string; email?: string; source?: string }) {
  const { admin, orgId } = await requireSuperadminForOrg();

  // If phone is provided, reuse an existing lead (webhook may have created it first)
  if (data.phone) {
    const { data: existing } = await admin
      .from("leads")
      .select("*")
      .eq("organization_id", orgId)
      .eq("phone", data.phone)
      .maybeSingle();
    if (existing) {
      // Merge provided fields into the existing lead instead of creating a duplicate
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (data.name && !existing.name) patch.name = data.name;
      if (data.email && !existing.email) patch.email = data.email;
      await admin.from("leads").update(patch).eq("id", existing.id);
      revalidatePath("/leads");
      return { data: { ...existing, ...patch }, error: null };
    }
  }

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      organization_id: orgId,
      name: data.name,
      phone: data.phone || null,
      email: data.email || null,
      source: data.source || "manual",
      status: "new",
      channel: "whatsapp",
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  revalidatePath("/leads");
  return { data: lead, error: null };
}

export async function updateLead(leadId: string, updates: Record<string, unknown>) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin
    .from("leads")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/leads");
  return { error: null };
}

export async function deleteLead(leadId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const { error } = await admin
    .from("leads")
    .delete()
    .eq("id", leadId)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/leads");
  return { error: null };
}

export async function getLeadActivities(leadId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  // Verify lead belongs to active org before fetching activities
  const { data: lead } = await admin
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();
  if (!lead) return { data: null, error: "Lead nao encontrado nesta organizacao" };

  const { data, error } = await admin
    .from("lead_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}
