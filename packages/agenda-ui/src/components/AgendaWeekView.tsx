"use client";

import * as React from "react";
import {
  type Appointment,
  formatTime,
} from "@persia/shared/agenda";
import { AppointmentStatusBadge } from "./AppointmentStatusBadge";

interface AgendaWeekViewProps {
  /** Data dentro da semana a exibir. */
  currentDate: Date;
  appointments: readonly Appointment[];
  onSelect?: (a: Appointment) => void;
  timezone?: string;
}

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const HOUR_HEIGHT_PX = 64; // 64px = 1h
const HOURS_VISIBLE = Array.from({ length: 13 }, (_, i) => i + 7); // 7h às 19h

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function getZonedDateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(new Date(iso));
}

function getZonedHourMinutes(iso: string, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });
  const parts = fmt.formatToParts(new Date(iso));
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = parseInt(p.value, 10);
    else if (p.type === "minute") m = parseInt(p.value, 10);
  }
  if (h === 24) h = 0;
  return h * 60 + m;
}

export const AgendaWeekView: React.FC<AgendaWeekViewProps> = ({
  currentDate,
  appointments,
  onSelect,
  timezone = "America/Sao_Paulo",
}) => {
  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const todayKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(new Date());

  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="grid min-w-[700px] grid-cols-[60px_repeat(7,1fr)]">
        {/* Header dos dias */}
        <div className="border-b border-r border-slate-200 bg-slate-50 p-2" />
        {days.map((d) => {
          const dayKey = new Intl.DateTimeFormat("en-CA", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            timeZone: timezone,
          }).format(d);
          const isToday = dayKey === todayKey;
          return (
            <div
              key={dayKey}
              className={[
                "border-b border-slate-200 p-3 text-center",
                isToday ? "bg-indigo-50" : "bg-slate-50",
              ].join(" ")}
            >
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {WEEKDAY_SHORT[d.getDay()]}
              </p>
              <p
                className={[
                  "mt-1 text-lg font-black tabular-nums",
                  isToday ? "text-indigo-600" : "text-slate-900",
                ].join(" ")}
              >
                {d.getDate()}
              </p>
            </div>
          );
        })}

        {/* Grid de horas + dias */}
        {/* Coluna de horas */}
        <div className="border-r border-slate-200 bg-slate-50">
          {HOURS_VISIBLE.map((h) => (
            <div
              key={h}
              className="border-b border-slate-200 px-2 text-right"
              style={{ height: `${HOUR_HEIGHT_PX}px` }}
            >
              <span className="text-[10px] font-bold tabular-nums text-slate-400">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>

        {/* Colunas dos dias */}
        {days.map((d) => {
          const dayKey = new Intl.DateTimeFormat("en-CA", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            timeZone: timezone,
          }).format(d);

          const dayAppts = appointments.filter(
            (a) => !a.deleted_at && getZonedDateKey(a.start_at, timezone) === dayKey,
          );

          return (
            <div
              key={dayKey}
              className="relative border-r border-slate-200 last:border-r-0"
              style={{ height: `${HOURS_VISIBLE.length * HOUR_HEIGHT_PX}px` }}
            >
              {HOURS_VISIBLE.map((h) => (
                <div
                  key={h}
                  className="border-b border-slate-100"
                  style={{ height: `${HOUR_HEIGHT_PX}px` }}
                />
              ))}

              {dayAppts.map((appt) => {
                const startMin = getZonedHourMinutes(appt.start_at, timezone);
                const endMin = getZonedHourMinutes(appt.end_at, timezone);
                const baseMin = HOURS_VISIBLE[0]! * 60;
                const offsetTop = ((startMin - baseMin) / 60) * HOUR_HEIGHT_PX;
                const height = Math.max(
                  ((endMin - startMin) / 60) * HOUR_HEIGHT_PX,
                  24,
                );
                if (offsetTop < 0 || offsetTop > HOURS_VISIBLE.length * HOUR_HEIGHT_PX)
                  return null;

                return (
                  <button
                    key={appt.id}
                    type="button"
                    onClick={() => onSelect?.(appt)}
                    className="absolute left-1 right-1 overflow-hidden rounded-lg bg-indigo-50 p-1.5 text-left ring-1 ring-indigo-200 transition hover:bg-indigo-100"
                    style={{ top: `${offsetTop}px`, height: `${height}px` }}
                    title={appt.title}
                  >
                    <p className="truncate text-[10px] font-black text-indigo-900">
                      {formatTime(appt.start_at, timezone)} · {appt.title}
                    </p>
                    {height > 40 && (
                      <div className="mt-1">
                        <AppointmentStatusBadge status={appt.status} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
