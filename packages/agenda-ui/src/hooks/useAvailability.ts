"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AvailabilityRule,
  CreateAvailabilityRuleInput,
  UpdateAvailabilityRuleInput,
} from "@persia/shared/agenda";
import { useAgendaActions } from "../context";

export function useAvailability(filters: { user_id?: string } = {}) {
  const actions = useAgendaActions();
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersKey = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await actions.getAvailabilityRules(filters);
      setRules(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao carregar disponibilidade",
      );
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
      input: Omit<CreateAvailabilityRuleInput, "user_id"> & { user_id?: string },
    ) => {
      const created = await actions.createAvailabilityRule(input);
      setRules((prev) => [...prev, created]);
      return created;
    },
    [actions],
  );

  const update = useCallback(
    async (id: string, input: UpdateAvailabilityRuleInput) => {
      const updated = await actions.updateAvailabilityRule(id, input);
      setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
      return updated;
    },
    [actions],
  );

  const remove = useCallback(
    async (id: string) => {
      await actions.deleteAvailabilityRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    },
    [actions],
  );

  return { rules, loading, error, refresh, create, update, remove };
}
