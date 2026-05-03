"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

interface TimeRangeInputProps {
  start: string; // "HH:mm"
  end: string;
  onChange: (start: string, end: string) => void;
  onRemove?: () => void;
  invalid?: boolean;
}

/** Editor de uma janela "HH:mm - HH:mm" usado dentro de cada AvailabilityDayRow. */
export const TimeRangeInput: React.FC<TimeRangeInputProps> = ({
  start,
  end,
  onChange,
  onRemove,
  invalid = false,
}) => {
  return (
    <div
      className={[
        "flex items-center gap-2 rounded-xl border bg-card px-2 py-1.5",
        invalid ? "border-destructive/50" : "border-border",
      ].join(" ")}
    >
      <input
        type="time"
        value={start}
        onChange={(e) => onChange(e.target.value, end)}
        aria-label="Início"
        className="bg-transparent text-sm font-bold tabular-nums text-foreground outline-none"
      />
      <span className="text-xs font-bold text-muted-foreground/70">—</span>
      <input
        type="time"
        value={end}
        onChange={(e) => onChange(start, e.target.value)}
        aria-label="Término"
        className="bg-transparent text-sm font-bold tabular-nums text-foreground outline-none"
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remover janela"
          className="ml-1 rounded-lg p-1 text-muted-foreground/70 transition hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};
