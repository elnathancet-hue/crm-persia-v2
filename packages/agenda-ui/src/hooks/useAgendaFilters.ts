"use client";

import { useCallback, useMemo, useState } from "react";

export type AgendaViewMode = "day" | "week" | "month" | "list";

/**
 * State client-side puro pra navegacao do calendar (data atual, view mode,
 * helpers de avancar/voltar, formatacao do titulo do periodo). Sem
 * dependencia de actions.
 */
export function useAgendaFilters(initialDate: Date = new Date()) {
  const [currentDate, setCurrentDate] = useState<Date>(initialDate);
  const [viewMode, setViewMode] = useState<AgendaViewMode>("week");

  const handlePrev = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      switch (viewMode) {
        case "day":
          d.setDate(d.getDate() - 1);
          break;
        case "week":
          d.setDate(d.getDate() - 7);
          break;
        case "month":
          d.setMonth(d.getMonth() - 1);
          break;
        case "list":
          d.setDate(d.getDate() - 7);
          break;
      }
      return d;
    });
  }, [viewMode]);

  const handleNext = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      switch (viewMode) {
        case "day":
          d.setDate(d.getDate() + 1);
          break;
        case "week":
          d.setDate(d.getDate() + 7);
          break;
        case "month":
          d.setMonth(d.getMonth() + 1);
          break;
        case "list":
          d.setDate(d.getDate() + 7);
          break;
      }
      return d;
    });
  }, [viewMode]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const formatPeriodTitle = useMemo(() => {
    return () => {
      const fmtMonth = new Intl.DateTimeFormat("pt-BR", {
        month: "long",
        year: "numeric",
      });
      const fmtDay = new Intl.DateTimeFormat("pt-BR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      switch (viewMode) {
        case "day":
          return fmtDay.format(currentDate);
        case "week": {
          const weekStart = new Date(currentDate);
          weekStart.setDate(currentDate.getDate() - currentDate.getDay());
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          return `${weekStart.getDate()} - ${weekEnd.getDate()} de ${fmtMonth.format(weekEnd)}`;
        }
        case "month":
          return fmtMonth.format(currentDate);
        case "list":
          return fmtMonth.format(currentDate);
      }
    };
  }, [currentDate, viewMode]);

  return {
    currentDate,
    setCurrentDate,
    viewMode,
    setViewMode,
    handlePrev,
    handleNext,
    handleToday,
    formatPeriodTitle,
  };
}
