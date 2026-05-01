"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import {
  createBookingPage as createShared,
  deleteBookingPage as deleteShared,
  duplicateBookingPage as duplicateShared,
  getBookingPage as getShared,
  listBookingPages as listShared,
  updateBookingPage as updateShared,
  type AgendaMutationContext,
  type AgendaQueryContext,
  type BookingPage,
  type CreateBookingPageInput,
  type ListBookingPagesFilters,
  type UpdateBookingPageInput,
} from "@persia/shared/agenda";

export type { BookingPage };

function qctx(supabase: unknown, orgId: string): AgendaQueryContext {
  return { db: supabase as AgendaQueryContext["db"], orgId };
}

function mctx(
  supabase: unknown,
  orgId: string,
  userId: string,
): AgendaMutationContext {
  return {
    db: supabase as AgendaMutationContext["db"],
    orgId,
    userId,
    performedByRole: "agent",
  };
}

export async function getBookingPages(
  filters: ListBookingPagesFilters = {},
): Promise<BookingPage[]> {
  const { supabase, orgId } = await requireRole("agent");
  return listShared(qctx(supabase, orgId), filters);
}

export async function getBookingPageById(id: string): Promise<BookingPage | null> {
  const { supabase, orgId } = await requireRole("agent");
  return getShared(qctx(supabase, orgId), id);
}

export async function createBookingPage(
  input: Omit<CreateBookingPageInput, "user_id"> & { user_id?: string },
): Promise<BookingPage> {
  const { supabase, orgId, userId } = await requireRole("agent");
  const final: CreateBookingPageInput = {
    ...input,
    user_id: input.user_id ?? userId,
  };
  const created = await createShared(mctx(supabase, orgId, userId), final);
  revalidatePath("/agenda/paginas-de-agendamento");
  return created;
}

export async function updateBookingPage(
  id: string,
  input: UpdateBookingPageInput,
): Promise<BookingPage> {
  const { supabase, orgId, userId } = await requireRole("agent");
  const updated = await updateShared(mctx(supabase, orgId, userId), id, input);
  revalidatePath("/agenda/paginas-de-agendamento");
  return updated;
}

export async function duplicateBookingPage(
  id: string,
  new_slug: string,
): Promise<BookingPage> {
  const { supabase, orgId, userId } = await requireRole("agent");
  const duplicated = await duplicateShared(
    mctx(supabase, orgId, userId),
    id,
    new_slug,
  );
  revalidatePath("/agenda/paginas-de-agendamento");
  return duplicated;
}

export async function deleteBookingPage(id: string): Promise<void> {
  const { supabase, orgId, userId } = await requireRole("admin");
  await deleteShared(mctx(supabase, orgId, userId), id);
  revalidatePath("/agenda/paginas-de-agendamento");
}
