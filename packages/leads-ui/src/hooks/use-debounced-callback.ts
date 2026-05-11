"use client";

// PR-P: helper compartilhado pra debounce trailing de router.refresh()
// nos hooks de realtime. Sem isso, burst de N eventos em <200ms
// dispara N refetches no servidor — desperdicio + risco de race.
//
// Pattern: trailing debounce 200ms. Cada chamada reseta o timer;
// quando para de chegar evento por 200ms, dispara UMA vez.
//
// Cleanup obrigatorio: limpa timer no unmount pra nao disparar
// refresh depois de componente desmontado (warning React).

import { useEffect, useRef, useCallback } from "react";

const DEFAULT_DELAY_MS = 200;

export function useDebouncedCallback(
  callback: () => void,
  delayMs: number = DEFAULT_DELAY_MS,
): () => void {
  // useRef pra sempre pegar a versao mais recente do callback
  // (evita stale closure quando o caller passa router.refresh
  // que e estavel mas o componente re-renderiza por outras razoes).
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    // Cleanup global no unmount: se houver timer pending, descarta.
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      callbackRef.current();
      timerRef.current = null;
    }, delayMs);
  }, [delayMs]);
}
