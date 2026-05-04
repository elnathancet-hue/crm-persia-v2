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

// ============================================================================
// listOrgActivities (PR-K7) — timeline global da org
// ============================================================================

export interface OrgActivityRow {
  id: string;
  lead_id: string;
  type: string;
  description: string | null;
  metadata: unknown;
  performed_by: string | null;
  created_at: string | null;
  /** Lead embed (nome + phone) — null se lead foi excluido. */
  leads: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
}

export interface OrgActivitiesResult {
  activities: OrgActivityRow[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ListOrgActivitiesOptions {
  /** Paginacao (1-based). Default 1. */
  page?: number;
  /** Itens por pagina. Default 30, max 100. */
  limit?: number;
  /** Filtra por lista de tipos. Vazio/undefined = todos. */
  types?: string[];
  /** Filtra por lead especifico. */
  leadId?: string;
}

/**
 * Lista activities de TODOS os leads da org pra timeline global do
 * Atividades tab (PR-K7). Pagina em order DESC por created_at.
 *
 * Embed do lead via select join (id, name, phone, email) — lead pode
 * vir null se foi excluido apos a activity ter sido criada.
 *
 * Multi-tenant: filtra organization_id explicito (defesa em
 * profundidade alem do RLS).
 */
export async function listOrgActivities(
  ctx: CrmQueryContext,
  opts: ListOrgActivitiesOptions = {},
): Promise<OrgActivitiesResult> {
  const { db, orgId } = ctx;
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = db
    .from("lead_activities")
    .select(
      "id, lead_id, type, description, metadata, performed_by, created_at, leads(id, name, phone, email)",
      { count: "exact" },
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (opts.types && opts.types.length > 0) {
    query = query.in("type", opts.types);
  }
  if (opts.leadId) {
    query = query.eq("lead_id", opts.leadId);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const total = count ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    activities: (data ?? []) as OrgActivityRow[],
    total,
    page,
    totalPages,
  };
}

export interface LeadForDealAssignment {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Lista compacta de leads do org para preencher seletores de deal
 * (id/name/phone/email apenas, ordem alfabetica, cap em 200).
 */
export async function listLeadsForDealAssignment(
  ctx: CrmQueryContext,
  opts: { limit?: number } = {},
): Promise<LeadForDealAssignment[]> {
  const { db, orgId } = ctx;
  const limit = opts.limit ?? 200;

  const { data, error } = await db
    .from("leads")
    .select("id, name, phone, email")
    .eq("organization_id", orgId)
    .order("name", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as LeadForDealAssignment[];
}
