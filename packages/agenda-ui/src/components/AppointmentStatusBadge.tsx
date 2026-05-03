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

// Cada status mantem identidade visual propria (necessario pra UX) mas com
// dark mode legivel. Tailwind precisa de classes literais — nao podemos
// compor `bg-${color}` em runtime.
const STATUS_CLASSES: Record<AppointmentStatus, string> = {
  awaiting_confirmation:
    "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  confirmed:
    "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  completed:
    "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30",
  cancelled:
    "bg-destructive/15 text-destructive ring-destructive/30 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  no_show:
    "bg-muted text-muted-foreground ring-border",
  rescheduled:
    "bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30",
};

export const AppointmentStatusBadge: React.FC<AppointmentStatusBadgeProps> = ({
  status,
  className = "",
}) => {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset",
        STATUS_CLASSES[status],
        className,
      ].join(" ")}
      title={APPOINTMENT_STATUS_LABELS[status]}
    >
      {APPOINTMENT_STATUS_LABELS[status]}
    </span>
  );
};
