"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type {
  LeadActivity,
  LeadDetail,
  LeadFilters,
  LeadWithTags,
} from "@persia/shared/crm";
import { fetchLead, listLeads } from "@persia/shared/crm";

// Re-exporta tipos canônicos pra manter o path `@/actions/leads` que vários
// componentes do CRM importam. Fonte da verdade: @persia/shared/crm.
export type { LeadActivity, LeadDetail, LeadFilters, LeadWithTags };

// `getLeads` e `getLead` sao thin wrappers em volta das queries
// compartilhadas em @persia/shared/crm. A logica de filtragem, paginacao e
// joins fica la — aqui apenas resolvemos auth (requireRole) e adaptamos o
// shape pro contrato historico do CRM (throw on error).
export async function getLeads(filters: LeadFilters = {}) {
  const { supabase, orgId } = await requireRole("agent");
  return listLeads({ db: supabase, orgId }, filters);
}

export async function getLead(id: string) {
  const { supabase, orgId } = await requireRole("agent");
  return fetchLead({ db: supabase, orgId }, id);
}

export async function createLead(formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");

  const name = formData.get("name") as string;
  const phone = formData.get("phone") as string;
  const email = formData.get("email") as string;
  const source = (formData.get("source") as string) || "manual";
  const status = (formData.get("status") as string) || "new";
  const channel = (formData.get("channel") as string) || "whatsapp";

  // If phone is provided, reuse existing lead (webhook may have created it)
  if (phone) {
    const { data: existing } = await supabase
      .from("leads")
      .select("*")
      .eq("organization_id", orgId)
      .eq("phone", phone)
      .maybeSingle();
    if (existing) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (name && !existing.name) patch.name = name;
      if (email && !existing.email) patch.email = email;
      await supabase.from("leads").update(patch as never).eq("id", existing.id);
      revalidatePath("/leads");
      return { ...existing, ...patch };
    }
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: orgId,
      name: name || null,
      phone: phone || null,
      email: email || null,
      source,
      status,
      channel,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/leads");
  return data;
}

export async function updateLead(id: string, formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");

  const name = formData.get("name") as string;
  const phone = formData.get("phone") as string;
  const email = formData.get("email") as string;
  const source = formData.get("source") as string;
  const status = formData.get("status") as string;
  const channel = formData.get("channel") as string;

  const updateData: Record<string, unknown> = {};
  if (name !== null) updateData.name = name || null;
  if (phone !== null) updateData.phone = phone || null;
  if (email !== null) updateData.email = email || null;
  if (source) updateData.source = source;
  if (status) updateData.status = status;
  if (channel) updateData.channel = channel;

  const { data, error } = await supabase
    .from("leads")
    .update(updateData as never)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Sync lead to UAZAPI (fire and forget)
  import("@/lib/whatsapp/sync").then(({ syncLeadToUazapi }) => {
    syncLeadToUazapi(orgId, id);
  }).catch((err) => {
    console.error("[updateLead] sync error:", err);
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  return data;
}

export async function deleteLead(id: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/leads");
  return { success: true };
}

export async function getOrgTags() {
  const { supabase, orgId } = await requireRole("agent");

  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .eq("organization_id", orgId)
    .order("name");

  if (error) {
    throw new Error(error.message);
  }

  return data as { id: string; name: string; color: string; organization_id: string; created_at: string }[];
}

export async function addTagToLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!lead) {
    throw new Error("Lead nao encontrado nesta organizacao");
  }

  const { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!tag) {
    throw new Error("Tag nao encontrada nesta organizacao");
  }

  const { error } = await supabase
    .from("lead_tags")
    .insert({ lead_id: leadId, tag_id: tagId, organization_id: orgId });

  if (error) {
    if (error.code === "23505") return; // duplicate, ignore
    throw new Error(error.message);
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/crm");
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { error } = await supabase
    .from("lead_tags")
    .delete()
    .eq("lead_id", leadId)
    .eq("tag_id", tagId)
    .eq("organization_id", orgId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/crm");
}
