"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Renderiza timestamp relativo ("há 2 minutos") de forma SSR-safe.
 *
 * Resolve o erro React #418 (hydration mismatch) que aparece em /leads
 * e outras listas quando o servidor renderiza com `new Date()` e o
 * cliente renderiza alguns ms depois com valor diferente.
 *
 * Estratégia:
 *   1. SSR / primeiro render -> mostra `fallback` (ex: data absoluta formatada)
 *   2. useEffect monta -> troca pro relativo, igual nos dois lados
 *   3. Atualiza periodicamente (default 60s)
 *
 * @example
 * <RelativeTime iso={lead.created_at} />
 * // SSR: "13/05/2026 14:32"
 * // pós-hidratação: "há 2 minutos"
 *
 * Referências:
 *   - packages/ui/docs/patterns.md (Pattern #2)
 */
export interface RelativeTimeProps extends React.HTMLAttributes<HTMLTimeElement> {
  /** ISO 8601 string ou Date. */
  iso: string | Date | null | undefined;
  /**
   * Texto SSR / pré-hidratação. Default: data absoluta formatada PT-BR.
   * Pode ser string fixa (ex: "—") ou função do Date.
   */
  fallback?: string | ((date: Date) => string);
  /**
   * Intervalo de refresh em ms. Default 60_000 (1 minuto).
   * Passar 0 desativa atualização automática.
   */
  refreshMs?: number;
  /** Texto pra valor inválido / nulo. Default "—". */
  emptyText?: string;
  /** Se true, adiciona "atrás" / "em" via `addSuffix`. Default true. */
  addSuffix?: boolean;
  /**
   * Função custom pra formatar o relativo após mount.
   * Use `formatRelativeShortPtBR` pra formato curto ("agora", "5min", "3h", "5d").
   * Default: `formatDistanceToNow(date, { addSuffix, locale: ptBR })`.
   */
  formatter?: (date: Date) => string;
}

function defaultFallback(date: Date): string {
  return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

/**
 * Helper de formato curto pt-BR ("agora", "5min", "3h", "5d", "12 mai").
 * Drop-in pros `formatRelativeShort` inline que existiam em vários
 * componentes (KanbanBoard, LeadInfoDrawer, LeadCommentsTab, ActivitiesTab).
 *
 * Use como `<RelativeTime iso={x} formatter={formatRelativeShortPtBR} />`.
 */
export function formatRelativeShortPtBR(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return format(date, "dd MMM", { locale: ptBR });
}

export function RelativeTime({
  iso,
  fallback,
  refreshMs = 60_000,
  emptyText = "—",
  addSuffix = true,
  formatter,
  ...rest
}: RelativeTimeProps) {
  const [mounted, setMounted] = useState(false);
  // tick força re-render periódico após mount
  const [, setTick] = useState(0);

  useEffect(() => {
    setMounted(true);
    if (refreshMs <= 0) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs]);

  if (!iso) {
    return (
      <time {...rest} suppressHydrationWarning>
        {emptyText}
      </time>
    );
  }

  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return (
      <time {...rest} suppressHydrationWarning>
        {emptyText}
      </time>
    );
  }

  const fallbackText =
    typeof fallback === "function"
      ? fallback(date)
      : fallback ?? defaultFallback(date);

  // Antes de montar no cliente -> texto absoluto idêntico ao SSR
  if (!mounted) {
    return (
      <time
        dateTime={date.toISOString()}
        title={defaultFallback(date)}
        {...rest}
        suppressHydrationWarning
      >
        {fallbackText}
      </time>
    );
  }

  const relative = formatter
    ? formatter(date)
    : formatDistanceToNow(date, { addSuffix, locale: ptBR });

  return (
    <time
      dateTime={date.toISOString()}
      title={defaultFallback(date)}
      {...rest}
      suppressHydrationWarning
    >
      {relative}
    </time>
  );
}
