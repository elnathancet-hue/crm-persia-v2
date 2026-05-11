"use client";

import * as React from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  type AppointmentStatus,
} from "@persia/shared/agenda";
import {
  TONE_BADGE_CLASSES,
  type AgendaTone,
} from "../lib/agenda-tones";

interface AppointmentStatusBadgeProps {
  status: AppointmentStatus;
  className?: string;
}

// PR9d: mapeia status -> tom semantico. As classes vivem em
// agenda-tones (uma fonte unica pra toda a Agenda). Cada status mantem
// identidade visual propria — necessario pra UX.
const STATUS_TONE: Record<AppointmentStatus, AgendaTone> = {
  awaiting_confirmation: "warning",
  confirmed: "success",
  completed: "info",
  cancelled: "danger",
  no_show: "neutral",
  rescheduled: "accent",
};

export const AppointmentStatusBadge: React.FC<AppointmentStatusBadgeProps> = ({
  status,
  className = "",
}) => {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset",
        TONE_BADGE_CLASSES[STATUS_TONE[status]],
        className,
      ].join(" ")}
      title={APPOINTMENT_STATUS_LABELS[status]}
    >
      {APPOINTMENT_STATUS_LABELS[status]}
    </span>
  );
};
