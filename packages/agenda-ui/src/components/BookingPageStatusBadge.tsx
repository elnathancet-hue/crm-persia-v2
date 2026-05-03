"use client";

import * as React from "react";
import {
  BOOKING_PAGE_STATUS_LABELS,
  type BookingPageStatus,
} from "@persia/shared/agenda";

interface BookingPageStatusBadgeProps {
  status: BookingPageStatus;
  className?: string;
}

const STATUS_CLASSES: Record<BookingPageStatus, string> = {
  draft:
    "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  active:
    "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  inactive: "bg-muted text-muted-foreground ring-border",
};

export const BookingPageStatusBadge: React.FC<BookingPageStatusBadgeProps> = ({
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
    >
      {BOOKING_PAGE_STATUS_LABELS[status]}
    </span>
  );
};
