"use client";

import * as React from "react";
import { CalendarOff } from "lucide-react";
import {
  type Appointment,
  formatDate,
  formatTimeRange,
  formatWeekday,
} from "@persia/shared/agenda";
import { AppointmentStatusBadge } from "./AppointmentStatusBadge";

interface AgendaListViewProps {
  appointments: readonly Appointment[];
  loading?: boolean;
  onSelect?: (a: Appointment) => void;
  timezone?: string;
}

interface DayGroup {
  /** YYYY-MM-DD no fuso. */
  dateKey: string;
  appointments: Appointment[];
}

function groupByDay(
  appointments: readonly Appointment[],
  timezone: string,
): DayGroup[] {
  const fmtKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  });
  const map = new Map<string, Appointment[]>();
  for (const a of appointments) {
    if (a.deleted_at) continue;
    const key = fmtKey.format(new Date(a.start_at));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, list]) => ({
      dateKey,
      appointments: list.sort((x, y) => x.start_at.localeCompare(y.start_at)),
    }));
}

export const AgendaListView: React.FC<AgendaListViewProps> = ({
  appointments,
  loading = false,
  onSelect,
  timezone = "America/Sao_Paulo",
}) => {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-3xl bg-muted ring-1 ring-border"
          />
        ))}
      </div>
    );
  }

  const groups = groupByDay(appointments, timezone);

  if (groups.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-muted p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-muted-foreground/70 shadow-sm">
          <CalendarOff size={20} />
        </div>
        <p className="mt-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Sem agendamentos
        </p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          Crie um novo no botão acima ou ajuste os filtros
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => {
        const refDate = new Date(group.appointments[0]!.start_at);
        return (
          <section key={group.dateKey}>
            <header className="mb-3 flex items-baseline gap-3 border-b border-border pb-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-foreground">
                {formatDate(refDate.toISOString(), timezone)}
              </h3>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                {formatWeekday(refDate.toISOString(), timezone)}
              </span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                {group.appointments.length}{" "}
                {group.appointments.length === 1 ? "compromisso" : "compromissos"}
              </span>
            </header>

            <ul className="space-y-2">
              {group.appointments.map((appt) => (
                <li key={appt.id}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(appt)}
                    className="group flex w-full items-center justify-between gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-border shadow-sm transition hover:ring-primary/40 hover:shadow-md"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="rounded-xl bg-muted px-3 py-2 text-xs font-black tabular-nums text-foreground">
                        {formatTimeRange(
                          appt.start_at,
                          appt.end_at,
                          appt.timezone,
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">
                          {appt.title}
                        </p>
                        {appt.location && (
                          <p className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground">
                            {appt.location}
                          </p>
                        )}
                      </div>
                    </div>
                    <AppointmentStatusBadge status={appt.status} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
