"use client";

import * as React from "react";
import {
  CalendarCheck,
  CheckCircle2,
  Clock as ClockIcon,
  XCircle,
} from "lucide-react";
import {
  type Appointment,
  type AppointmentStatus,
  BLOCKING_APPOINTMENT_STATUSES,
} from "@persia/shared/agenda";
import { TodayAppointments } from "./TodayAppointments";
import { TONE_PILL_CLASSES, type AgendaTone } from "../lib/agenda-tones";

interface AgendaOverviewProps {
  appointments: readonly Appointment[];
  loading?: boolean;
  onSelectAppointment?: (a: Appointment) => void;
  timezone?: string;
}

// PR9e: tons semanticos centralizados (agenda-tones). Antes era um
// mini-map indigo/amber/emerald/rose hardcoded. Agora reusa o helper.
// 4 tons aqui: brand (proximos), warning (aguardando), success
// (confirmados), danger (cancelados).
interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: Extract<AgendaTone, "brand" | "warning" | "success" | "danger">;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon, label, value, tone }) => (
  <div className="rounded-3xl bg-card p-5 ring-1 ring-border shadow-sm">
    <div className="flex items-center gap-3">
      <div
        className={[
          "flex h-10 w-10 items-center justify-center rounded-2xl",
          TONE_PILL_CLASSES[tone],
        ].join(" ")}
      >
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-black tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  </div>
);

function countByStatus(
  list: readonly Appointment[],
  status: AppointmentStatus,
): number {
  return list.filter((a) => !a.deleted_at && a.status === status).length;
}

export const AgendaOverview: React.FC<AgendaOverviewProps> = ({
  appointments,
  loading = false,
  onSelectAppointment,
  timezone = "America/Sao_Paulo",
}) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-3xl bg-muted ring-1 ring-border"
          />
        ))}
      </div>
    );
  }

  const upcoming = appointments.filter(
    (a) =>
      !a.deleted_at &&
      a.kind === "appointment" &&
      (BLOCKING_APPOINTMENT_STATUSES as readonly AppointmentStatus[]).includes(
        a.status,
      ) &&
      new Date(a.start_at).getTime() >= Date.now(),
  ).length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<CalendarCheck size={18} />}
          label="Próximos"
          value={upcoming}
          tone="brand"
        />
        <MetricCard
          icon={<ClockIcon size={18} />}
          label="Aguardando confirmação"
          value={countByStatus(appointments, "awaiting_confirmation")}
          tone="warning"
        />
        <MetricCard
          icon={<CheckCircle2 size={18} />}
          label="Realizados"
          value={countByStatus(appointments, "completed")}
          tone="success"
        />
        <MetricCard
          icon={<XCircle size={18} />}
          label="Cancelados"
          value={countByStatus(appointments, "cancelled")}
          tone="danger"
        />
      </div>

      <TodayAppointments
        appointments={appointments}
        onSelect={onSelectAppointment}
        timezone={timezone}
      />
    </div>
  );
};
