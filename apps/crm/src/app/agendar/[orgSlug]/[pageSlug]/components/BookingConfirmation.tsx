"use client";

import * as React from "react";
import { CalendarCheck, Clock } from "lucide-react";
import {
  formatDate,
  formatTimeRange,
  formatWeekday,
} from "@persia/shared/agenda";
import type { BookingConfirmation as ConfirmationData } from "@/actions/agenda/public";

interface BookingConfirmationProps {
  data: ConfirmationData;
}

export const BookingConfirmation: React.FC<BookingConfirmationProps> = ({
  data,
}) => {
  return (
    <div className="space-y-6 rounded-3xl bg-success-soft p-8 text-center ring-1 ring-success-ring">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-success text-success-foreground shadow-md shadow-success/30">
        <CalendarCheck size={28} />
      </div>

      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-success">
          Agendamento confirmado
        </p>
        <h2 className="mt-1 text-2xl font-black text-success-soft-foreground">
          {data.page_title}
        </h2>
        <p className="mt-1 text-sm text-success">
          com {data.organization_name}
        </p>
      </div>

      <div className="mx-auto max-w-sm space-y-2 rounded-2xl bg-card p-5 ring-1 ring-success-ring">
        <p className="flex items-center justify-center gap-2 text-sm font-bold capitalize text-foreground">
          <CalendarCheck size={14} className="text-success" />
          {formatWeekday(data.start_at, data.timezone)}
          {" · "}
          {formatDate(data.start_at, data.timezone)}
        </p>
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
          <Clock size={14} className="text-success" />
          {formatTimeRange(data.start_at, data.end_at, data.timezone)}
        </p>
      </div>

      <div className="space-y-1 text-xs text-success-soft-foreground">
        <p>
          Você receberá uma confirmação no WhatsApp informado em breve.
        </p>
        <p className="text-[11px] text-success">
          ID do agendamento:{" "}
          <code className="font-mono">{data.appointment_id.slice(0, 8)}</code>
        </p>
      </div>
    </div>
  );
};
