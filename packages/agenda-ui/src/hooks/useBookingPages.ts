"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BookingPage,
  CreateBookingPageInput,
  ListBookingPagesFilters,
  UpdateBookingPageInput,
} from "@persia/shared/agenda";
import { useAgendaActions } from "../context";

export function useBookingPages(filters: ListBookingPagesFilters = {}) {
  const actions = useAgendaActions();
  const [pages, setPages] = useState<BookingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersKey = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await actions.getBookingPages(filters);
      setPages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar páginas");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, filtersKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (
      input: Omit<CreateBookingPageInput, "user_id"> & { user_id?: string },
    ) => {
      const created = await actions.createBookingPage(input);
      setPages((prev) => [created, ...prev]);
      return created;
    },
    [actions],
  );

  const update = useCallback(
    async (id: string, input: UpdateBookingPageInput) => {
      const updated = await actions.updateBookingPage(id, input);
      setPages((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    },
    [actions],
  );

  const duplicate = useCallback(
    async (id: string, new_slug: string) => {
      const dup = await actions.duplicateBookingPage(id, new_slug);
      setPages((prev) => [dup, ...prev]);
      return dup;
    },
    [actions],
  );

  const remove = useCallback(
    async (id: string) => {
      await actions.deleteBookingPage(id);
      setPages((prev) => prev.filter((p) => p.id !== id));
    },
    [actions],
  );

  return { pages, loading, error, refresh, create, update, duplicate, remove };
}
