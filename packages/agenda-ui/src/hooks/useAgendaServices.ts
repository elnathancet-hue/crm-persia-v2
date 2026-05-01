"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AgendaService,
  CreateAgendaServiceInput,
  ListServicesFilters,
  UpdateAgendaServiceInput,
} from "@persia/shared/agenda";
import { useAgendaActions } from "../context";

export function useAgendaServices(filters: ListServicesFilters = {}) {
  const actions = useAgendaActions();
  const [services, setServices] = useState<AgendaService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersKey = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await actions.getAgendaServices(filters);
      setServices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar serviços");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, filtersKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: CreateAgendaServiceInput) => {
      const created = await actions.createAgendaService(input);
      setServices((prev) => [...prev, created]);
      return created;
    },
    [actions],
  );

  const update = useCallback(
    async (id: string, input: UpdateAgendaServiceInput) => {
      const updated = await actions.updateAgendaService(id, input);
      setServices((prev) => prev.map((s) => (s.id === id ? updated : s)));
      return updated;
    },
    [actions],
  );

  const remove = useCallback(
    async (id: string) => {
      await actions.deleteAgendaService(id);
      setServices((prev) => prev.filter((s) => s.id !== id));
    },
    [actions],
  );

  return { services, loading, error, refresh, create, update, remove };
}
