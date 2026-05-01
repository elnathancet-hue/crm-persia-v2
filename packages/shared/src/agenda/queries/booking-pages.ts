// booking_pages — queries read-only.
//
// Inclui `getBookingPagePublicBySlug` que NAO filtra por orgId (recebe
// `org_slug` em vez disso). Usado pelo endpoint publico /agendar/...
// — caller eh responsavel por garantir que o context esta isolado
// (rate-limit + sem session do CRM).

import type { BookingPage, BookingPageStatus } from "../types";
import type { AgendaQueryContext, AgendaQueryDb } from "./context";

const SELECT = `
  id, organization_id, user_id, service_id,
  slug, title, description, location, meeting_url,
  duration_minutes, buffer_minutes, lookahead_days,
  status, total_bookings,
  created_at, updated_at
`;

export interface ListBookingPagesFilters {
  status?: BookingPageStatus;
  user_id?: string;
}

export async function listBookingPages(
  ctx: AgendaQueryContext,
  filters: ListBookingPagesFilters = {},
): Promise<BookingPage[]> {
  const { db, orgId } = ctx;
  let query = db
    .from("booking_pages")
    .select(SELECT)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.user_id) query = query.eq("user_id", filters.user_id);

  const { data, error } = await query;
  if (error) throw new Error(`listBookingPages: ${error.message}`);
  return (data ?? []) as BookingPage[];
}

export async function getBookingPage(
  ctx: AgendaQueryContext,
  id: string,
): Promise<BookingPage | null> {
  const { db, orgId } = ctx;
  const { data, error } = await db
    .from("booking_pages")
    .select(SELECT)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getBookingPage: ${error.message}`);
  return (data as BookingPage | null) ?? null;
}

export interface BookingPagePublicResolved {
  page: BookingPage;
  organization: { id: string; name: string; slug: string };
}

/**
 * Lookup publico via (org_slug, page_slug). Retorna null se org nao
 * existe, page nao existe, ou status != 'active'.
 *
 * IMPORTANTE: NAO usa orgId do context (recebe `db` solto). Caller
 * (endpoint publico) deve usar service-role pra contornar RLS — ou um
 * cliente anonimo + uma policy publica pra esse SELECT especifico.
 *
 * Usado SO pelo PR5 (booking publico). Esconda atras de rate-limit.
 */
export async function getBookingPagePublicBySlug(
  db: AgendaQueryDb,
  org_slug: string,
  page_slug: string,
): Promise<BookingPagePublicResolved | null> {
  const { data: org, error: orgErr } = await db
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", org_slug)
    .maybeSingle();

  if (orgErr) throw new Error(`getBookingPagePublicBySlug.org: ${orgErr.message}`);
  if (!org) return null;

  const { data: page, error: pageErr } = await db
    .from("booking_pages")
    .select(SELECT)
    .eq("organization_id", (org as { id: string }).id)
    .eq("slug", page_slug)
    .eq("status", "active")
    .maybeSingle();

  if (pageErr) throw new Error(`getBookingPagePublicBySlug.page: ${pageErr.message}`);
  if (!page) return null;

  return {
    page: page as BookingPage,
    organization: org as { id: string; name: string; slug: string },
  };
}
