"use client";

import * as React from "react";
import type { Appointment } from "@persia/shared/agenda";

interface AgendaMonthViewProps {
  /** Mês exibido (qualquer dia dentro). */
  currentDate: Date;
  appointments: readonly Appointment[];
  onSelectDay?: (date: Date) => void;
  onSelectAppointment?: (a: Appointment) => void;
  timezone?: string;
}

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

function getMonthMatrix(d: Date): Date[][] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const startOffset = first.getDay();
  const matrix: Date[][] = [];
  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - startOffset);

  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let dow = 0; dow < 7; dow++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    matrix.push(week);
  }
  return matrix;
}

function fmtDayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
}

export const AgendaMonthView: React.FC<AgendaMonthViewProps> = ({
  currentDate,
  appointments,
  onSelectDay,
  onSelectAppointment,
  timezone = "America/Sao_Paulo",
}) => {
  const matrix = getMonthMatrix(currentDate);
  const monthIndex = currentDate.getMonth();
  const todayKey = fmtDayKey(new Date(), timezone);

  // Indexa appointments por dia local.
  const byDay = new Map<string, Appointment[]>();
  for (const a of appointments) {
    if (a.deleted_at) continue;
    const key = fmtDayKey(new Date(a.start_at), timezone);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(a);
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {WEEKDAY_SHORT.map((wd) => (
          <div
            key={wd}
            className="border-r border-slate-200 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-500 last:border-r-0"
          >
            {wd}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {matrix.flat().map((day) => {
          const dayKey = fmtDayKey(day, timezone);
          const isCurrentMonth = day.getMonth() === monthIndex;
          const isToday = dayKey === todayKey;
          const dayAppts = byDay.get(dayKey) ?? [];

          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => onSelectDay?.(day)}
              className={[
                "min-h-[110px] border-b border-r border-slate-200 p-2 text-left align-top transition last:border-r-0 hover:bg-slate-50",
                isCurrentMonth ? "bg-white" : "bg-slate-50/50 text-slate-400",
                isToday ? "ring-2 ring-inset ring-indigo-400" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <span
                  className={[
                    "text-xs font-black tabular-nums",
                    isToday
                      ? "text-indigo-600"
                      : isCurrentMonth
                        ? "text-slate-900"
                        : "text-slate-400",
                  ].join(" ")}
                >
                  {day.getDate()}
                </span>
                {dayAppts.length > 0 && (
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black text-indigo-700">
                    {dayAppts.length}
                  </span>
                )}
              </div>
              <ul className="mt-1.5 space-y-1">
                {dayAppts.slice(0, 2).map((a) => (
                  <li key={a.id}>
                    <span
                      role="link"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAppointment?.(a);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          onSelectAppointment?.(a);
                        }
                      }}
                      className="block truncate rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800 ring-1 ring-indigo-100"
                    >
                      {a.title}
                    </span>
                  </li>
                ))}
                {dayAppts.length > 2 && (
                  <li className="text-[10px] font-semibold text-slate-500">
                    + {dayAppts.length - 2} mais
                  </li>
                )}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
};
