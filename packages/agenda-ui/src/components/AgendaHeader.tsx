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
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Período anterior"
            className="rounded-xl p-2 text-slate-600 transition hover:bg-white hover:text-indigo-600"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="rounded-xl bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-700 shadow-sm transition hover:text-indigo-600"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Próximo período"
            className="rounded-xl p-2 text-slate-600 transition hover:bg-white hover:text-indigo-600"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm font-bold capitalize text-slate-900">
          <CalIcon size={14} className="text-indigo-500" />
          {periodTitle}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-2xl bg-slate-100 p-1">
          {(Object.keys(VIEW_LABELS) as AgendaViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSetViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={[
                "rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition",
                viewMode === mode
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-900",
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
            className="inline-flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700"
          >
            <Plus size={14} />
            Novo
          </button>
        )}
      </div>
    </header>
  );
};
