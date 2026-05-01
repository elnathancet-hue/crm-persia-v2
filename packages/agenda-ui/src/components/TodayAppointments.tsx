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

  if (today.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
          <AlertCircle size={20} />
        </div>
        <p className="mt-4 text-xs font-bold uppercase tracking-widest text-slate-500">
          Nenhum agendamento hoje
        </p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          Aproveite pra organizar a semana
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-700">
        <CalendarCheck size={14} className="text-indigo-600" />
        Hoje · {today.length} {today.length === 1 ? "compromisso" : "compromissos"}
      </div>
      <ul className="space-y-2">
        {today.map((appt) => (
          <li key={appt.id}>
            <button
              type="button"
              onClick={() => onSelect?.(appt)}
              className="group flex w-full items-center justify-between gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-slate-200 transition hover:ring-indigo-300"
            >
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
                  {formatTime(appt.start_at, timezone)}
                </span>
                <span className="truncate text-sm font-bold text-slate-900">
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
