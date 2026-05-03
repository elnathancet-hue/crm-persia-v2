"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadminForOrg } from "@/lib/auth";
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

function qctx(admin: unknown, orgId: string): AgendaQueryContext {
  return { db: admin as AgendaQueryContext["db"], orgId };
}
function mctx(
  admin: unknown,
  orgId: string,
  userId: string,
): AgendaMutationContext {
  return {
    db: admin as AgendaMutationContext["db"],
    orgId,
    userId,
    performedByRole: "admin",
  };
}

export async function getBookingPages(
  filters: ListBookingPagesFilters = {},
): Promise<BookingPage[]> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return listShared(qctx(admin, orgId), filters);
}

export async function getBookingPageById(
  id: string,
): Promise<BookingPage | null> {
  const { admin, orgId } = await requireSuperadminForOrg();
  return getShared(qctx(admin, orgId), id);
}

export async function createBookingPage(
  input: Omit<CreateBookingPageInput, "user_id"> & { user_id?: string },
): Promise<BookingPage> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const final: CreateBookingPageInput = {
    ...input,
    user_id: input.user_id ?? userId,
  };
  const created = await createShared(mctx(admin, orgId, userId), final);
  revalidatePath(`/clients/${orgId}/agenda`);
  return created;
}

export async function updateBookingPage(
  id: string,
  input: UpdateBookingPageInput,
): Promise<BookingPage> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const updated = await updateShared(mctx(admin, orgId, userId), id, input);
  revalidatePath(`/clients/${orgId}/agenda`);
  return updated;
}

export async function duplicateBookingPage(
  id: string,
  new_slug: string,
): Promise<BookingPage> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  const duplicated = await duplicateShared(
    mctx(admin, orgId, userId),
    id,
    new_slug,
  );
  revalidatePath(`/clients/${orgId}/agenda`);
  return duplicated;
}

export async function deleteBookingPage(id: string): Promise<void> {
  const { admin, orgId, userId } = await requireSuperadminForOrg();
  await deleteShared(mctx(admin, orgId, userId), id);
  revalidatePath(`/clients/${orgId}/agenda`);
}
