"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalIcon,
  Plus,
} from "lucide-react";
import { Button } from "@persia/ui/button";
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

// PR-AGENDA-DS (mai/2026): refactor pra usar primitivos do DS.
// Antes: botoes HTML raw com `rounded-2xl` + `font-black uppercase
// tracking-widest` + `text-white` hardcoded — destoava do resto do CRM.
// Agora: Button do @persia/ui (hover azul automatico) + tipografia
// consistente com o padrao DS Polish.
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
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onPrev}
            aria-label="Período anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToday}
            className="font-semibold"
          >
            Hoje
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onNext}
            aria-label="Próximo período"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 text-sm font-semibold capitalize text-foreground">
          <CalIcon className="size-4 text-primary" />
          {periodTitle}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
          {(Object.keys(VIEW_LABELS) as AgendaViewMode[]).map((mode) => {
            const isActive = viewMode === mode;
            return (
              <Button
                key={mode}
                type="button"
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                onClick={() => onSetViewMode(mode)}
                aria-pressed={isActive}
                className="font-medium"
              >
                {VIEW_LABELS[mode]}
              </Button>
            );
          })}
        </div>

        {onCreate && (
          <Button type="button" variant="default" onClick={onCreate}>
            <Plus className="size-4" data-icon="inline-start" />
            Novo
          </Button>
        )}
      </div>
    </header>
  );
};
