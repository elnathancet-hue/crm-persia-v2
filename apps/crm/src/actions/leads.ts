"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export type LeadFilters = {
  search?: string;
  status?: string;
  tags?: string[];
  page?: number;
  limit?: number;
};

export type LeadWithTags = {
  id: string;
  organization_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  source: string;
  status: string;
  score: number;
  whatsapp_id: string | null;
  channel: string;
  opt_in: boolean;
  metadata: unknown;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
  lead_tags: {
    tag_id: string;
    tags: {
      id: string;
      name: string;
      color: string;
    };
  }[];
};

export type LeadDetail = LeadWithTags & {
  lead_custom_field_values: {
    id: string;
    custom_field_id: string;
    value: string;
    custom_fields: {
      id: string;
      name: string;
      field_type: string;
    };
  }[];
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  performed_by: string | null;
  type: string;
  description: string | null;
  metadata: unknown;
  created_at: string | null;
};

export async function getLeads(filters: LeadFilters = {}) {
  const { supabase, orgId } = await requireRole("agent");
  const { search, status, tags, page = 1, limit = 20 } = filters;

  const from = (page - 1) * limit;
  const to = from + limit - 1;
  let leadIdsFromTags: string[] | null = null;

  if (tags && tags.length > 0) {
    const { data: taggedLeads, error: tagError } = await supabase
      .from("lead_tags")
      .select("lead_id")
      .eq("organization_id", orgId)
      .in("tag_id", tags);

    if (tagError) {
      throw new Error(tagError.message);
    }

    leadIdsFromTags = Array.from(
      new Set((taggedLeads || []).map((row) => row.lead_id).filter(Boolean))
    );

    if (leadIdsFromTags.length === 0) {
      return {
        leads: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }
  }

  let query = supabase
    .from("leads")
    .select(
      `
      *,
      lead_tags (
        tag_id,
        tags (
          id,
          name,
          color
        )
      )
    `,
      { count: "exact" }
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    const sanitized = search.replace(/[%_,()\\]/g, "").trim();
    if (sanitized) {
      query = query.or(
        `name.ilike.%${sanitized}%,email.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`
      );
    }
  }

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (leadIdsFromTags) {
    query = query.in("id", leadIdsFromTags);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return {
    leads: data as LeadWithTags[],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  };
}

export async function getLead(id: string) {
  const { supabase, orgId } = await requireRole("agent");

  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      `
      *,
      lead_tags (
        tag_id,
        tags (
          id,
          name,
          color
        )
      )
    `
    )
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Fetch custom field values separately
  const { data: customFieldValues } = await supabase
    .from("lead_custom_field_values")
    .select(
      `
      id,
      custom_field_id,
      value,
      custom_fields (
        id,
        name,
        field_type
      )
    `
    )
    .eq("lead_id", id);

  // Fetch activities
  const { data: activities } = await supabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  return {
    lead: {
      ...lead,
      lead_custom_field_values: customFieldValues ?? [],
    } as LeadDetail,
    activities: (activities ?? []) as LeadActivity[],
  };
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
