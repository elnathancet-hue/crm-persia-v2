"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Appointment,
  AppointmentStatus,
  CancelAppointmentInput,
  CreateAppointmentInput,
  ListAppointmentsFilters,
  RescheduleAppointmentInput,
  UpdateAppointmentInput,
} from "@persia/shared/agenda";
import { useAgendaActions } from "../context";

/**
 * Hook principal pra listar/mutar appointments. Consome AgendaActions via
 * context — apps injetam suas server actions reais.
 */
export function useAppointments(filters: ListAppointmentsFilters = {}) {
  const actions = useAgendaActions();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stringify pra estabilizar a dep no useEffect — filters eh objeto.
  const filtersKey = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await actions.getAppointments(filters);
      setAppointments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar agendamentos");
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
      input: Omit<CreateAppointmentInput, "user_id"> & { user_id?: string },
    ) => {
      const created = await actions.createAppointment(input);
      setAppointments((prev) => [...prev, created]);
      return created;
    },
    [actions],
  );

  const update = useCallback(
    async (id: string, input: UpdateAppointmentInput) => {
      const updated = await actions.updateAppointment(id, input);
      setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
      return updated;
    },
    [actions],
  );

  const updateStatus = useCallback(
    async (id: string, status: AppointmentStatus) => {
      const updated = await actions.updateAppointmentStatus(id, status);
      setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
      return updated;
    },
    [actions],
  );

  const cancel = useCallback(
    async (id: string, input: CancelAppointmentInput = {}) => {
      const updated = await actions.cancelAppointment(id, input);
      setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)));
      return updated;
    },
    [actions],
  );

  const reschedule = useCallback(
    async (id: string, input: RescheduleAppointmentInput) => {
      const result = await actions.rescheduleAppointment(id, input);
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? result.original : a)).concat(result.replacement),
      );
      return result;
    },
    [actions],
  );

  const remove = useCallback(
    async (id: string) => {
      await actions.deleteAppointment(id);
      setAppointments((prev) => prev.filter((a) => a.id !== id));
    },
    [actions],
  );

  return {
    appointments,
    loading,
    error,
    refresh,
    create,
    update,
    updateStatus,
    cancel,
    reschedule,
    remove,
  };
}
