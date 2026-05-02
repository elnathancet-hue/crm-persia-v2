"use client";

import * as React from "react";
import { Calendar, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { AvailableSlot } from "@persia/shared/agenda";
import { getPublicSlotsForDate } from "@/actions/agenda/public";

interface PublicSlotPickerProps {
  pageId: string;
  lookaheadDays: number;
  onSelectSlot: (slot: AvailableSlot, timezone: string) => void;
}

function fmtKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtLabel(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

export const PublicSlotPicker: React.FC<PublicSlotPickerProps> = ({
  pageId,
  lookaheadDays,
  onSelectSlot,
}) => {
  const today = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [date, setDate] = React.useState<Date>(today);
  const [slots, setSlots] = React.useState<AvailableSlot[]>([]);
  const [timezone, setTimezone] = React.useState<string>("America/Sao_Paulo");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dateKey = fmtKey(date);
  const minDate = today;
  const maxDate = React.useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + lookaheadDays - 1);
    return d;
  }, [today, lookaheadDays]);

  const isPrevDisabled = date.getTime() <= minDate.getTime();
  const isNextDisabled = date.getTime() >= maxDate.getTime();

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPublicSlotsForDate(pageId, dateKey)
      .then((r) => {
        if (cancelled) return;
        setSlots(r.slots);
        setTimezone(r.timezone);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Erro ao carregar horários");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, dateKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => {
            const d = new Date(date);
            d.setDate(d.getDate() - 1);
            if (d.getTime() >= minDate.getTime()) setDate(d);
          }}
          disabled={isPrevDisabled}
          aria-label="Dia anterior"
          className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="flex items-center gap-2 text-sm font-bold capitalize text-slate-900">
          <Calendar size={14} className="text-indigo-500" />
          {fmtLabel(date)}
        </div>

        <button
          type="button"
          onClick={() => {
            const d = new Date(date);
            d.setDate(d.getDate() + 1);
            if (d.getTime() <= maxDate.getTime()) setDate(d);
          }}
          disabled={isNextDisabled}
          aria-label="Próximo dia"
          className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-slate-400">
          <Loader2 size={20} className="mr-2 animate-spin" /> Carregando horários...
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </div>
      ) : slots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-sm font-bold text-slate-700">
            Sem horários disponíveis nesse dia
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Tente uma data próxima usando as setas acima
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slots.map((slot) => (
            <button
              key={slot.start_at}
              type="button"
              onClick={() => onSelectSlot(slot, timezone)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold tabular-nums text-slate-900 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              {slot.display_time}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
