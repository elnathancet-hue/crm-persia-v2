"use client";

import * as React from "react";
import {
  BOOKING_PAGE_STATUS_LABELS,
  type BookingPageStatus,
} from "@persia/shared/agenda";
import {
  TONE_BADGE_CLASSES,
  type AgendaTone,
} from "../lib/agenda-tones";

interface BookingPageStatusBadgeProps {
  status: BookingPageStatus;
  className?: string;
}

// PR9d: tons semanticos centralizados. draft -> aguardando publicacao
// (warning), active -> publicada (success), inactive -> neutro.
const STATUS_TONE: Record<BookingPageStatus, AgendaTone> = {
  draft: "warning",
  active: "success",
  inactive: "neutral",
};

export const BookingPageStatusBadge: React.FC<BookingPageStatusBadgeProps> = ({
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
    >
      {BOOKING_PAGE_STATUS_LABELS[status]}
    </span>
  );
};
