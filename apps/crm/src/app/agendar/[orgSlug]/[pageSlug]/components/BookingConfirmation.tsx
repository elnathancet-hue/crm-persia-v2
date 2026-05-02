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
    <div className="space-y-6 rounded-3xl bg-emerald-50 p-8 text-center ring-1 ring-emerald-200">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-200">
        <CalendarCheck size={28} />
      </div>

      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
          Agendamento confirmado
        </p>
        <h2 className="mt-1 text-2xl font-black text-emerald-950">
          {data.page_title}
        </h2>
        <p className="mt-1 text-sm text-emerald-700">
          com {data.organization_name}
        </p>
      </div>

      <div className="mx-auto max-w-sm space-y-2 rounded-2xl bg-white p-5 ring-1 ring-emerald-200">
        <p className="flex items-center justify-center gap-2 text-sm font-bold capitalize text-slate-900">
          <CalendarCheck size={14} className="text-emerald-600" />
          {formatWeekday(data.start_at, data.timezone)}
          {" · "}
          {formatDate(data.start_at, data.timezone)}
        </p>
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
          <Clock size={14} className="text-emerald-600" />
          {formatTimeRange(data.start_at, data.end_at, data.timezone)}
        </p>
      </div>

      <div className="space-y-1 text-xs text-emerald-900">
        <p>
          Você receberá uma confirmação no WhatsApp informado em breve.
        </p>
        <p className="text-[11px] text-emerald-700">
          ID do agendamento:{" "}
          <code className="font-mono">{data.appointment_id.slice(0, 8)}</code>
        </p>
      </div>
    </div>
  );
};
