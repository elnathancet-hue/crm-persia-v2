"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { LeadFilters, LeadWithTags } from "@persia/shared/crm";
import {
  fetchLead,
  fetchLeadActivities,
  listLeads,
} from "@persia/shared/crm";

// Re-exporta tipos canônicos. Admin não usa whatsapp_id/opt_in/metadata
// (são opcionais no tipo shared), então as queries existentes continuam
// compatíveis.
export type { LeadFilters, LeadWithTags };

// `getLeads`, `getLeadDetail` e `getLeadActivities` sao thin wrappers
// em volta das queries compartilhadas. Auth via requireSuperadminForOrg;
// adaptamos o shape da resposta pro contrato historico do admin
// (`{ data, error, count }` em vez de throw).
export async function getLeads(filters: LeadFilters = {}) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const result = await listLeads({ db: admin, orgId }, filters);
    return { data: result.leads, error: null, count: result.total };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Erro desconhecido",
      count: 0,
    };
  }
}

export async function getLeadDetail(leadId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const { lead } = await fetchLead({ db: admin, orgId }, leadId);
    return { data: lead, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
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
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const data = await fetchLeadActivities(
      { db: admin, orgId },
      leadId,
      { limit: 50 },
    );
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Erro desconhecido",
    };
  }
}
