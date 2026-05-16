"use client";

import * as React from "react";
import { CalendarCheck, AlertCircle } from "lucide-react";
import {
  type Appointment,
  formatTime,
} from "@persia/shared/agenda";
import { AppointmentStatusBadge } from "./AppointmentStatusBadge";

interface TodayAppointmentsProps {
  appointments: readonly Appointment[];
  onSelect?: (appointment: Appointment) => void;
  /** Default 'America/Sao_Paulo'. */
  timezone?: string;
}

function isToday(iso: string, timezone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  });
  return fmt.format(new Date(iso)) === fmt.format(new Date());
}

export const TodayAppointments: React.FC<TodayAppointmentsProps> = ({
  appointments,
  onSelect,
  timezone = "America/Sao_Paulo",
}) => {
  const today = appointments
    .filter((a) => !a.deleted_at && a.kind === "appointment")
    .filter((a) => isToday(a.start_at, timezone))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  // PR-AGENDA-DS (mai/2026): tokens consistentes com resto do CRM.
  // Antes: rounded-2xl/3xl + font-black uppercase tracking-widest.
  // Agora: rounded-xl + font-semibold + ring-border virou border-border.
  if (today.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/40 p-10 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-card text-muted-foreground/70 shadow-xs">
          <AlertCircle className="size-5" />
        </div>
        <p className="mt-4 text-sm font-semibold text-foreground">
          Nenhum agendamento hoje
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Aproveite para organizar a semana.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <CalendarCheck className="size-4 text-primary" />
        Hoje · {today.length} {today.length === 1 ? "compromisso" : "compromissos"}
      </div>
      <ul className="space-y-2">
        {today.map((appt) => (
          <li key={appt.id}>
            <button
              type="button"
              onClick={() => onSelect?.(appt)}
              className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.02]"
            >
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-primary">
                  {formatTime(appt.start_at, timezone)}
                </span>
                <span className="truncate text-sm font-semibold text-foreground">
                  {appt.title}
                </span>
              </div>
              <AppointmentStatusBadge status={appt.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
