"use client";

import * as React from "react";
import type { Appointment } from "@persia/shared/agenda";
import type { AgendaViewMode } from "../hooks/useAgendaFilters";
import { AgendaWeekView } from "./AgendaWeekView";
import { AgendaMonthView } from "./AgendaMonthView";
import { AgendaListView } from "./AgendaListView";

interface AgendaCalendarViewProps {
  viewMode: AgendaViewMode;
  currentDate: Date;
  appointments: readonly Appointment[];
  loading?: boolean;
  onSelectAppointment?: (a: Appointment) => void;
  onSelectDay?: (d: Date) => void;
  timezone?: string;
}

/**
 * Switcher entre Week / Month / List. View "day" cai no list por enquanto
 * (uma view dedicada Day fica pra um PR posterior se necessario).
 */
export const AgendaCalendarView: React.FC<AgendaCalendarViewProps> = ({
  viewMode,
  currentDate,
  appointments,
  loading = false,
  onSelectAppointment,
  onSelectDay,
  timezone = "America/Sao_Paulo",
}) => {
  if (loading) {
    return (
      <div className="h-[600px] animate-pulse rounded-3xl bg-slate-100 ring-1 ring-slate-200" />
    );
  }

  switch (viewMode) {
    case "week":
      return (
        <AgendaWeekView
          currentDate={currentDate}
          appointments={appointments}
          onSelect={onSelectAppointment}
          timezone={timezone}
        />
      );
    case "month":
      return (
        <AgendaMonthView
          currentDate={currentDate}
          appointments={appointments}
          onSelectAppointment={onSelectAppointment}
          onSelectDay={onSelectDay}
          timezone={timezone}
        />
      );
    case "list":
    case "day":
    default:
      return (
        <AgendaListView
          appointments={appointments}
          onSelect={onSelectAppointment}
          timezone={timezone}
        />
      );
  }
};
