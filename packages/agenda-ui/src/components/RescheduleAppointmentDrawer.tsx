"use client";

import * as React from "react";
import { CalendarClock, X } from "lucide-react";
import {
  type Appointment,
  formatTimeRange,
} from "@persia/shared/agenda";
import { useAgendaActions, useAgendaCallbacks } from "../context";
import { localToUtcIso } from "./CreateAppointmentDrawer";

interface RescheduleAppointmentDrawerProps {
  appointment: Appointment | null;
  onClose: () => void;
}

function isoToLocalInput(iso: string, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export const RescheduleAppointmentDrawer: React.FC<
  RescheduleAppointmentDrawerProps
> = ({ appointment, onClose }) => {
  const actions = useAgendaActions();
  const { agendaUsers = [], onAppointmentChange } = useAgendaCallbacks();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<string | null>(null);

  const tz = appointment?.timezone ?? "America/Sao_Paulo";
  const initialStart = appointment ? isoToLocalInput(appointment.start_at, tz) : "";
  const initialEnd = appointment ? isoToLocalInput(appointment.end_at, tz) : "";

  const [startLocal, setStartLocal] = React.useState(initialStart);
  const [endLocal, setEndLocal] = React.useState(initialEnd);
  const [userId, setUserId] = React.useState(appointment?.user_id ?? "");

  // Sincroniza quando appointment muda
  React.useEffect(() => {
    if (appointment) {
      setStartLocal(isoToLocalInput(appointment.start_at, tz));
      setEndLocal(isoToLocalInput(appointment.end_at, tz));
      setUserId(appointment.user_id);
      setError(null);
      setConflict(null);
    }
  }, [appointment, tz]);

  if (!appointment) return null;

  const formError = (() => {
    if (!startLocal || !endLocal) return "Início e término obrigatórios";
    if (new Date(endLocal).getTime() <= new Date(startLocal).getTime())
      return "Término deve ser após o início";
    return null;
  })();

  const sameAsCurrent =
    startLocal === initialStart &&
    endLocal === initialEnd &&
    userId === appointment.user_id;

  const handleSubmit = async () => {
    setError(null);
    setConflict(null);
    if (formError) {
      setError(formError);
      return;
    }
    setSubmitting(true);
    try {
      const new_start_at = localToUtcIso(startLocal, tz);
      const new_end_at = localToUtcIso(endLocal, tz);
      await actions.rescheduleAppointment(appointment.id, {
        new_start_at,
        new_end_at,
        new_user_id: userId !== appointment.user_id ? userId : undefined,
      });
      onAppointmentChange?.(appointment.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao reagendar";
      if (msg.startsWith("Conflito com")) {
        setConflict(msg);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative flex h-full w-full max-w-md flex-col bg-card shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <CalendarClock size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black text-foreground">Reagendar</h2>
              <p className="truncate text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {appointment.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-xl p-1.5 text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            <p className="font-bold text-foreground">Horário atual</p>
            <p className="mt-0.5">
              {formatTimeRange(appointment.start_at, appointment.end_at, tz)}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Novo início
            </label>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Novo término
            </label>
            <input
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {agendaUsers.length > 0 && (
            <div>
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Responsável (opcional — mudar)
              </label>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {agendaUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="rounded-xl bg-primary/10 p-3 text-[11px] text-primary ring-1 ring-primary/30">
            <strong>Como funciona:</strong> o agendamento atual fica marcado como
            "Reagendado" (audit) e um novo é criado no horário escolhido,
            esperando confirmação.
          </p>

          {conflict && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
              ⚠ {conflict}
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive ring-1 ring-destructive/30">
              {error}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground transition hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || sameAsCurrent || Boolean(formError)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white shadow-md shadow-amber-200 transition hover:bg-amber-700 disabled:opacity-50"
          >
            <CalendarClock size={14} />
            {submitting ? "Reagendando..." : "Confirmar"}
          </button>
        </footer>
      </aside>
    </div>
  );
};
