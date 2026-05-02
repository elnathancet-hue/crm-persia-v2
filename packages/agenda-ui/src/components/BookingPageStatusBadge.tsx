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
  draft: "bg-amber-100 text-amber-800 ring-amber-200",
  active: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  inactive: "bg-slate-100 text-slate-700 ring-slate-200",
};

export const BookingPageStatusBadge: React.FC<BookingPageStatusBadgeProps> = ({
  status,
  className = "",
}) => {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ring-1 ring-inset",
        STATUS_CLASSES[status],
        className,
      ].join(" ")}
    >
      {BOOKING_PAGE_STATUS_LABELS[status]}
    </span>
  );
};
