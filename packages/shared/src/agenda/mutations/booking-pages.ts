// booking_pages — mutations.

import type { BookingPage, BookingPageStatus } from "../types";
import type { AgendaMutationContext } from "../queries/context";

const RETURN = `
  id, organization_id, user_id, service_id,
  slug, title, description, location, meeting_url,
  duration_minutes, buffer_minutes, lookahead_days,
  status, total_bookings,
  created_at, updated_at
`;

export interface CreateBookingPageInput {
  user_id: string;
  service_id?: string | null;
  slug: string;
  title: string;
  description?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  duration_minutes: number;
  buffer_minutes?: number;
  lookahead_days?: number;
  status?: BookingPageStatus;
}

export class BookingPageSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingPageSlugError";
  }
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,49}$/;

function validateSlug(slug: string) {
  if (!SLUG_REGEX.test(slug)) {
    throw new BookingPageSlugError(
      "Slug invalido — use a-z, 0-9 e hifen (1-50 chars, comecando com letra/numero)",
    );
  }
}

export async function createBookingPage(
  ctx: AgendaMutationContext,
  input: CreateBookingPageInput,
): Promise<BookingPage> {
  validateSlug(input.slug);
  const { db, orgId } = ctx;

  const { data, error } = await db
    .from("booking_pages")
    .insert({
      organization_id: orgId,
      user_id: input.user_id,
      service_id: input.service_id ?? null,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      meeting_url: input.meeting_url ?? null,
      duration_minutes: input.duration_minutes,
      buffer_minutes: input.buffer_minutes ?? 0,
      lookahead_days: input.lookahead_days ?? 30,
      status: input.status ?? "draft",
    })
    .select(RETURN)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new BookingPageSlugError(
        `Slug "${input.slug}" ja esta em uso na organizacao`,
      );
    }
    throw new Error(`createBookingPage: ${error.message}`);
  }
  return data as BookingPage;
}

export interface UpdateBookingPageInput {
  service_id?: string | null;
  slug?: string;
  title?: string;
  description?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  duration_minutes?: number;
  buffer_minutes?: number;
  lookahead_days?: number;
  status?: BookingPageStatus;
}

export async function updateBookingPage(
  ctx: AgendaMutationContext,
  id: string,
  input: UpdateBookingPageInput,
): Promise<BookingPage> {
  if (input.slug !== undefined) validateSlug(input.slug);
  const { db, orgId } = ctx;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.service_id !== undefined) patch.service_id = input.service_id;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.location !== undefined) patch.location = input.location;
  if (input.meeting_url !== undefined) patch.meeting_url = input.meeting_url;
  if (input.duration_minutes !== undefined)
    patch.duration_minutes = input.duration_minutes;
  if (input.buffer_minutes !== undefined)
    patch.buffer_minutes = input.buffer_minutes;
  if (input.lookahead_days !== undefined)
    patch.lookahead_days = input.lookahead_days;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await db
    .from("booking_pages")
    .update(patch)
    .eq("organization_id", orgId)
    .eq("id", id)
    .select(RETURN)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new BookingPageSlugError(
        `Slug "${input.slug}" ja esta em uso na organizacao`,
      );
    }
    throw new Error(`updateBookingPage: ${error.message}`);
  }
  return data as BookingPage;
}

export async function duplicateBookingPage(
  ctx: AgendaMutationContext,
  id: string,
  new_slug: string,
): Promise<BookingPage> {
  validateSlug(new_slug);
  const { db, orgId } = ctx;

  const { data: source, error: srcErr } = await db
    .from("booking_pages")
    .select(RETURN)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (srcErr) throw new Error(`duplicateBookingPage.fetch: ${srcErr.message}`);
  if (!source) throw new Error("duplicateBookingPage: original nao encontrado");

  const src = source as BookingPage;
  return createBookingPage(ctx, {
    user_id: src.user_id,
    service_id: src.service_id,
    slug: new_slug,
    title: `${src.title} (Cópia)`,
    description: src.description,
    location: src.location,
    meeting_url: src.meeting_url,
    duration_minutes: src.duration_minutes,
    buffer_minutes: src.buffer_minutes,
    lookahead_days: src.lookahead_days,
    status: "draft", // copia sempre nasce draft
  });
}

export async function deleteBookingPage(
  ctx: AgendaMutationContext,
  id: string,
): Promise<void> {
  const { db, orgId } = ctx;
  const { error } = await db
    .from("booking_pages")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`deleteBookingPage: ${error.message}`);
}
