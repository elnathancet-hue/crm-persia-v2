// Leads — queries read-only compartilhadas entre apps/crm e apps/admin.
//
// Implementa a logica de filtragem, paginacao, joins e org-scoping uma
// unica vez. Apps continuam expondo suas server actions com o shape de
// retorno que cada um esperar (CRM throw, admin retorna { data, error })
// — basta wrappear estas funcoes.

import type {
  LeadActivity,
  LeadDetail,
  LeadFilters,
  LeadWithTags,
} from "../types";
import type { CrmQueryContext } from "./context";

export interface PaginatedLeads {
  leads: LeadWithTags[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const SEARCH_SANITIZE_REGEX = /[%_,()\\]/g;

/**
 * Lista leads do org com paginacao, filtros opcionais (search, status,
 * tags) e tags inline. Throw em qualquer erro de DB.
 */
export async function listLeads(
  ctx: CrmQueryContext,
  filters: LeadFilters = {},
): Promise<PaginatedLeads> {
  const { db, orgId } = ctx;
  const { search, status, tags, page = 1, limit = 20 } = filters;

  const from = (page - 1) * limit;
  const to = from + limit - 1;
  let leadIdsFromTags: string[] | null = null;

  // Pre-filter via lead_tags se foi pedido por tags.
  if (tags && tags.length > 0) {
    const { data: taggedLeads, error: tagError } = await db
      .from("lead_tags")
      .select("lead_id")
      .eq("organization_id", orgId)
      .in("tag_id", tags);

    if (tagError) throw new Error(tagError.message);

    leadIdsFromTags = Array.from(
      new Set(
        ((taggedLeads ?? []) as { lead_id: string | null }[])
          .map((row) => row.lead_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (leadIdsFromTags.length === 0) {
      return { leads: [], total: 0, page, limit, totalPages: 0 };
    }
  }

  let query = db
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
      { count: "exact" },
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    const sanitized = search.replace(SEARCH_SANITIZE_REGEX, "").trim();
    if (sanitized) {
      query = query.or(
        `name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%,email.ilike.%${sanitized}%`,
      );
    }
  }

  // CRM passa "all" pra dizer "sem filtro" — admin nunca passa "all".
  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (leadIdsFromTags) {
    query = query.in("id", leadIdsFromTags);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const total = count ?? 0;
  return {
    leads: (data ?? []) as LeadWithTags[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Lead unico com tags + custom fields embed + activities.
 * Throw se o lead nao existe ou nao pertence ao org.
 */
export async function fetchLead(
  ctx: CrmQueryContext,
  leadId: string,
): Promise<{ lead: LeadDetail; activities: LeadActivity[] }> {
  const { db, orgId } = ctx;

  const { data: lead, error } = await db
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
    )
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();

  if (error) throw new Error(error.message);

  // Custom fields buscado separado (tabela diferente, RLS independente).
  const { data: customFieldValues } = await db
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
      `,
    )
    .eq("lead_id", leadId);

  const { data: activities } = await db
    .from("lead_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  return {
    lead: {
      ...lead,
      lead_custom_field_values: customFieldValues ?? [],
    } as LeadDetail,
    activities: (activities ?? []) as LeadActivity[],
  };
}

/**
 * Activities de um lead. Verifica que o lead pertence ao org antes (defesa
 * em profundidade pra service-role que bypassa RLS). Aceita `limit`
 * opcional (admin usa 50; CRM nao limita).
 */
export async function fetchLeadActivities(
  ctx: CrmQueryContext,
  leadId: string,
  opts: { limit?: number } = {},
): Promise<LeadActivity[]> {
  const { db, orgId } = ctx;

  const { data: lead, error: leadError } = await db
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (leadError) throw new Error(leadError.message);
  if (!lead) throw new Error("Lead nao encontrado nesta organizacao");

  let query = db
    .from("lead_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (typeof opts.limit === "number" && opts.limit > 0) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadActivity[];
}
