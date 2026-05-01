"use client";

import * as React from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  type AppointmentStatus,
} from "@persia/shared/agenda";

interface AppointmentStatusBadgeProps {
  status: AppointmentStatus;
  className?: string;
}

// Tailwind precisa de classes literais — nao podemos compor `bg-${color}`.
const STATUS_CLASSES: Record<AppointmentStatus, string> = {
  awaiting_confirmation: "bg-amber-100 text-amber-800 ring-amber-200",
  confirmed: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  completed: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  cancelled: "bg-rose-100 text-rose-800 ring-rose-200",
  no_show: "bg-slate-100 text-slate-700 ring-slate-200",
  rescheduled: "bg-blue-100 text-blue-800 ring-blue-200",
};

export const AppointmentStatusBadge: React.FC<AppointmentStatusBadgeProps> = ({
  status,
  className = "",
}) => {
  const classes = STATUS_CLASSES[status];
  const label = APPOINTMENT_STATUS_LABELS[status];

  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ring-1 ring-inset",
        classes,
        className,
      ].join(" ")}
      title={label}
    >
      {label}
    </span>
  );
};
