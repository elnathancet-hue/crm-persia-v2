"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import type { AvailabilityDay } from "@persia/shared/agenda";
import { TimeRangeInput } from "./TimeRangeInput";

const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

interface AvailabilityDayRowProps {
  day: AvailabilityDay;
  onChange: (day: AvailabilityDay) => void;
}

/**
 * Editor de uma linha por dia da semana — toggle on/off + N intervalos.
 * Usado dentro do WeeklyAvailabilityEditor.
 */
export const AvailabilityDayRow: React.FC<AvailabilityDayRowProps> = ({
  day,
  onChange,
}) => {
  const handleToggle = () => {
    onChange({ ...day, enabled: !day.enabled });
  };

  const handleAddInterval = () => {
    const intervals = [...day.intervals, { start: "09:00", end: "18:00" }];
    onChange({ ...day, intervals });
  };

  const handleUpdateInterval = (idx: number, start: string, end: string) => {
    const intervals = day.intervals.map((iv, i) =>
      i === idx ? { start, end } : iv,
    );
    onChange({ ...day, intervals });
  };

  const handleRemoveInterval = (idx: number) => {
    const intervals = day.intervals.filter((_, i) => i !== idx);
    onChange({ ...day, intervals });
  };

  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <div className="flex w-44 shrink-0 items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={day.enabled}
            onChange={handleToggle}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm font-bold text-slate-900">
            {WEEKDAY_LABELS[day.day_of_week]}
          </span>
        </label>
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        {!day.enabled ? (
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Indisponível
          </span>
        ) : day.intervals.length === 0 ? (
          <span className="text-xs font-semibold text-slate-400">
            Sem janela configurada
          </span>
        ) : (
          day.intervals.map((iv, idx) => (
            <TimeRangeInput
              key={idx}
              start={iv.start}
              end={iv.end}
              onChange={(s, e) => handleUpdateInterval(idx, s, e)}
              onRemove={() => handleRemoveInterval(idx)}
            />
          ))
        )}

        {day.enabled && (
          <button
            type="button"
            onClick={handleAddInterval}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-600 transition hover:bg-indigo-50"
          >
            <Plus size={12} />
            Janela
          </button>
        )}
      </div>
    </div>
  );
};
