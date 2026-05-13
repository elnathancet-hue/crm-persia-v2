"use client";

import { useCallback, useOptimistic, useTransition } from "react";

/**
 * Wrapper de `useOptimistic` (React 19) para mutações em listas.
 *
 * Padroniza:
 *  - Aplicação otimista imediata
 *  - Execução da Server Action dentro de `startTransition`
 *  - Rollback automático em caso de erro (o React faz isso ao reverter
 *    pro state base quando a transition rejeita)
 *
 * @example
 * const { items, mutate, pending } = useOptimisticList<Lead, OptimisticOp>({
 *   initial: leads,
 *   reducer: (state, op) => {
 *     if (op.type === "delete") return state.filter((l) => l.id !== op.id);
 *     if (op.type === "rename") return state.map((l) =>
 *       l.id === op.id ? { ...l, name: op.name } : l);
 *     return state;
 *   },
 * });
 *
 * async function handleDelete(id: string) {
 *   await mutate({ type: "delete", id }, () => deleteLeadAction(id));
 * }
 *
 * Referências:
 *   - packages/ui/docs/patterns.md (Pattern #4)
 */
export interface UseOptimisticListOptions<TItem, TOp> {
  initial: TItem[];
  reducer: (state: TItem[], op: TOp) => TItem[];
}

export interface UseOptimisticListReturn<TItem, TOp> {
  items: TItem[];
  mutate: (op: TOp, action: () => Promise<unknown>) => Promise<void>;
  pending: boolean;
}

export function useOptimisticList<TItem, TOp>(
  options: UseOptimisticListOptions<TItem, TOp>,
): UseOptimisticListReturn<TItem, TOp> {
  const { initial, reducer } = options;
  const [optimistic, applyOptimistic] = useOptimistic<TItem[], TOp>(
    initial,
    reducer,
  );
  const [pending, startTransition] = useTransition();

  const mutate = useCallback(
    (op: TOp, action: () => Promise<unknown>) =>
      new Promise<void>((resolve) => {
        startTransition(async () => {
          applyOptimistic(op);
          try {
            await action();
          } catch {
            // Em caso de erro, useOptimistic reverte automaticamente
            // quando a transition acabar. Caller cuida de toast/log.
          }
          resolve();
        });
      }),
    [applyOptimistic],
  );

  return { items: optimistic, mutate, pending };
}
