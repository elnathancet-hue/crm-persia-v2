"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Calendar as CalIcon, Plus } from "lucide-react";
import type { AgendaViewMode } from "../hooks/useAgendaFilters";

interface AgendaHeaderProps {
  periodTitle: string;
  viewMode: AgendaViewMode;
  onSetViewMode: (mode: AgendaViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onCreate?: () => void;
}

const VIEW_LABELS: Record<AgendaViewMode, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
  list: "Lista",
};

export const AgendaHeader: React.FC<AgendaHeaderProps> = ({
  periodTitle,
  viewMode,
  onSetViewMode,
  onPrev,
  onNext,
  onToday,
  onCreate,
}) => {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-2xl bg-muted p-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Período anterior"
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-card hover:text-primary"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="rounded-xl bg-card px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-foreground shadow-sm transition hover:text-primary"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Próximo período"
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-card hover:text-primary"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm font-bold capitalize text-foreground">
          <CalIcon size={14} className="text-primary" />
          {periodTitle}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-2xl bg-muted p-1">
          {(Object.keys(VIEW_LABELS) as AgendaViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSetViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={[
                "rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition",
                viewMode === mode
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {VIEW_LABELS[mode]}
            </button>
          ))}
        </div>

        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-primary px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md shadow-primary/20 transition hover:bg-primary/90"
          >
            <Plus size={14} />
            Novo
          </button>
        )}
      </div>
    </header>
  );
};
