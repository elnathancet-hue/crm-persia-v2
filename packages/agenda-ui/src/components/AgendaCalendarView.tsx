"use client";

import * as React from "react";
import {
  Calendar,
  dateFnsLocalizer,
  Views,
  type Event as RBCEvent,
  type SlotInfo,
  type View,
} from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  type Appointment,
  type AppointmentStatus,
  type AvailabilityRule,
  APPOINTMENT_STATUS_LABELS,
} from "@persia/shared/agenda";
import type { AgendaViewMode } from "../hooks/useAgendaFilters";

// CSS do react-big-calendar + tweaks visuais Persia.
import "react-big-calendar/lib/css/react-big-calendar.css";
import "./agenda-calendar.css";

// ============================================================================
// Localizer pt-BR via date-fns
// ============================================================================

const locales = { "pt-BR": ptBR };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

const MESSAGES = {
  allDay: "Dia inteiro",
  previous: "Anterior",
  next: "Próximo",
  today: "Hoje",
  month: "Mês",
  week: "Semana",
  day: "Dia",
  agenda: "Lista",
  date: "Data",
  time: "Hora",
  event: "Evento",
  noEventsInRange: "Sem agendamentos no período.",
  showMore: (total: number) => `+${total} mais`,
};

// ============================================================================
// Estilo dos eventos (cor por status + kind)
// ============================================================================

interface EventResource {
  appointment: Appointment;
}

type CalEvent = RBCEvent & {
  resource: EventResource;
};

// PR-DS-TOKENS (jun/2026): trocado hex hardcoded por CSS vars semanticas
// do design system — light/dark resolve automaticamente via globals.css.
const STATUS_COLORS: Record<
  AppointmentStatus,
  { bg: string; bar: string; text: string }
> = {
  awaiting_confirmation: {
    bg: "var(--warning-soft)",
    bar: "var(--warning)",
    text: "var(--warning-soft-foreground)",
  },
  confirmed: {
    bg: "var(--success-soft)",
    bar: "var(--success)",
    text: "var(--success-soft-foreground)",
  },
  completed: {
    bg: "var(--progress-soft)",
    bar: "var(--progress)",
    text: "var(--progress-soft-foreground)",
  },
  cancelled: {
    bg: "var(--failure-soft)",
    bar: "var(--failure)",
    text: "var(--failure-soft-foreground)",
  },
  no_show: {
    bg: "var(--muted)",
    bar: "var(--muted-foreground)",
    text: "var(--muted-foreground)",
  },
  rescheduled: {
    bg: "color-mix(in srgb, var(--primary) 12%, transparent)",
    bar: "var(--primary)",
    text: "var(--primary)",
  },
};

function getEventStyle(event: CalEvent) {
  const a = (event.resource as EventResource).appointment as Appointment;

  if (a.kind === "block") {
    return {
      style: {
        backgroundColor: "#f1f5f9",
        backgroundImage:
          "repeating-linear-gradient(45deg, #e2e8f0 0, #e2e8f0 4px, transparent 4px, transparent 8px)",
        border: "1px solid #cbd5e1",
        borderLeft: "3px solid #94a3b8",
        color: "#475569",
        opacity: 0.85,
      },
    };
  }

  if (a.kind === "event") {
    return {
      style: {
        backgroundColor: "#f3e8ff",
        border: "1px solid #ddd6fe",
        borderLeft: "3px solid #a855f7",
        color: "#581c87",
      },
    };
  }

  const c = STATUS_COLORS[a.status];
  const style: React.CSSProperties = {
    backgroundColor: c.bg,
    border: `1px solid ${c.bar}33`,
    borderLeft: `3px solid ${c.bar}`,
    color: c.text,
  };
  if (a.status === "cancelled") {
    style.textDecoration = "line-through";
    style.opacity = 0.6;
  }
  return { style };
}

// ============================================================================
// Min/Max time da view Day/Week — extrai da availability rule
// ============================================================================

function pickMinMaxFromRule(
  rule: AvailabilityRule | null | undefined,
): { min: Date; max: Date } {
  const today = new Date();
  today.setMilliseconds(0);
  const FALLBACK_START_H = 7;
  const FALLBACK_END_H = 19;

  if (!rule || !rule.days || rule.days.length === 0) {
    const min = new Date(today);
    min.setHours(FALLBACK_START_H, 0, 0, 0);
    const max = new Date(today);
    max.setHours(FALLBACK_END_H, 0, 0, 0);
    return { min, max };
  }

  let earliestMin = 24 * 60;
  let latestMin = 0;
  for (const d of rule.days) {
    if (!d.enabled) continue;
    for (const iv of d.intervals) {
      const [sh, sm] = iv.start.split(":").map(Number);
      const [eh, em] = iv.end.split(":").map(Number);
      const sM = (sh ?? 0) * 60 + (sm ?? 0);
      const eM = (eh ?? 0) * 60 + (em ?? 0);
      if (sM < earliestMin) earliestMin = sM;
      if (eM > latestMin) latestMin = eM;
    }
  }
  if (earliestMin >= latestMin) {
    earliestMin = FALLBACK_START_H * 60;
    latestMin = FALLBACK_END_H * 60;
  }

  const min = new Date(today);
  min.setHours(Math.floor(earliestMin / 60), earliestMin % 60, 0, 0);
  const max = new Date(today);
  max.setHours(Math.floor(latestMin / 60), latestMin % 60, 0, 0);
  return { min, max };
}

// ============================================================================
// Mapeia AgendaViewMode <-> RBC View
// ============================================================================

function toRbcView(v: AgendaViewMode): View {
  switch (v) {
    case "day":
      return Views.DAY;
    case "week":
      return Views.WEEK;
    case "month":
      return Views.MONTH;
    case "list":
    default:
      return Views.AGENDA;
  }
}

function fromRbcView(v: View): AgendaViewMode {
  switch (v) {
    case Views.DAY:
      return "day";
    case Views.WEEK:
      return "week";
    case Views.MONTH:
      return "month";
    case Views.AGENDA:
    default:
      return "list";
  }
}

// ============================================================================
// Component
// ============================================================================

interface AgendaCalendarViewProps {
  viewMode: AgendaViewMode;
  currentDate: Date;
  appointments: readonly Appointment[];
  /** Regra de disponibilidade do user pra definir min/max time. */
  availabilityRule?: AvailabilityRule | null;
  loading?: boolean;
  onSelectAppointment?: (a: Appointment) => void;
  /** Click em slot vazio (Day/Week views) — abre Create drawer pre-preenchido. */
  onSelectSlot?: (slot: { start: Date; end: Date }) => void;
  /** Ressincronia quando user troca view via toolbar nativa do RBC. */
  onChangeView?: (v: AgendaViewMode) => void;
  onChangeDate?: (d: Date) => void;
}

export const AgendaCalendarView: React.FC<AgendaCalendarViewProps> = ({
  viewMode,
  currentDate,
  appointments,
  availabilityRule,
  loading = false,
  onSelectAppointment,
  onSelectSlot,
  onChangeView,
  onChangeDate,
}) => {
  const events: CalEvent[] = React.useMemo(
    () =>
      appointments
        .filter((a) => !a.deleted_at)
        .map((a) => ({
          id: a.id,
          title: a.title,
          start: new Date(a.start_at),
          end: new Date(a.end_at),
          allDay: false,
          resource: { appointment: a },
        })),
    [appointments],
  );

  const { min, max } = React.useMemo(
    () => pickMinMaxFromRule(availabilityRule),
    [availabilityRule],
  );

  const handleSelectEvent = React.useCallback(
    (event: CalEvent) => {
      onSelectAppointment?.(event.resource.appointment);
    },
    [onSelectAppointment],
  );

  const handleSelectSlot = React.useCallback(
    (slot: SlotInfo) => {
      onSelectSlot?.({
        start: slot.start as Date,
        end: slot.end as Date,
      });
    },
    [onSelectSlot],
  );

  if (loading) {
    return (
      <div className="h-[600px] animate-pulse rounded-xl border border-border bg-muted" />
    );
  }

  return (
    // PR-AGENDA-DS Fase 2 (mai/2026): rounded-3xl/ring-1 → rounded-xl/border.
    <div className="agenda-rbc-wrap rounded-xl border border-border bg-card p-2 shadow-xs">
      <Calendar<CalEvent>
        localizer={localizer}
        culture="pt-BR"
        messages={MESSAGES}
        events={events}
        startAccessor={(e) => e.start as Date}
        endAccessor={(e) => e.end as Date}
        view={toRbcView(viewMode)}
        date={currentDate}
        onView={(v) => onChangeView?.(fromRbcView(v))}
        onNavigate={(d) => onChangeDate?.(d)}
        views={["month", "week", "day", "agenda"]}
        defaultView="week"
        min={min}
        max={max}
        step={30}
        timeslots={2}
        selectable
        popup
        onSelectEvent={handleSelectEvent}
        onSelectSlot={handleSelectSlot}
        eventPropGetter={getEventStyle}
        tooltipAccessor={(e) => {
          const a = (e.resource as EventResource).appointment as Appointment;
          return `${e.title ?? ""} — ${APPOINTMENT_STATUS_LABELS[a.status]}`;
        }}
        style={{ height: 700 }}
      />
    </div>
  );
};
