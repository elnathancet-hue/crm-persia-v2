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
  // PR-AGENDA-DS Fase 2 (mai/2026): tokens DS consistentes.
  // rounded-3xl/2xl → rounded-xl; font-black → font-semibold/bold;
  // ring-1 ring-border → border-border; hora pill com bg-primary/10.
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-border bg-muted"
          />
        ))}
      </div>
    );
  }

  const groups = groupByDay(appointments, timezone);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/40 p-12 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-card text-muted-foreground/70 shadow-xs">
          <CalendarOff className="size-5" />
        </div>
        <p className="mt-4 text-sm font-semibold text-foreground">
          Sem agendamentos
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Crie um novo no botão acima ou ajuste os filtros.
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
              <h3 className="font-heading text-sm font-semibold tracking-tight text-foreground">
                {formatDate(refDate.toISOString(), timezone)}
              </h3>
              <span className="text-xs font-medium text-muted-foreground/80">
                {formatWeekday(refDate.toISOString(), timezone)}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
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
                    className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/[0.02]"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <span className="rounded-md bg-primary/10 px-3 py-2 text-xs font-semibold tabular-nums text-primary">
                        {formatTimeRange(
                          appt.start_at,
                          appt.end_at,
                          appt.timezone,
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {appt.title}
                        </p>
                        {appt.location && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
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
