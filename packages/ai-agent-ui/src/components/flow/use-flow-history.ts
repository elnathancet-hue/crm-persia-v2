"use client";

// PR 24 (mai/2026): useFlowHistory — undo/redo stack pro canvas.
//
// Modelo:
//   - `past[]`: snapshots ANTES de cada mutação. Topo = estado
//     imediatamente anterior à última ação. Cap em maxSize itens
//     (FIFO — descarta o mais antigo quando estoura).
//   - `future[]`: snapshots de estados desfeitos. Cresce só via
//     undo(); zera quando uma ação nova é gravada via push().
//
// Contrato:
//   - Caller chama `push(currentSnapshot)` ANTES de cada mutação.
//     Snapshot é o estado AGORA (antes de mudar), não o estado novo.
//   - Caller chama `undo(currentSnapshot)` quando o usuário fizer
//     undo. Hook devolve o snapshot anterior (ou null se vazio),
//     e empurra o atual pro futuro pra permitir redo.
//   - `redo(currentSnapshot)`: simétrico — pega último do futuro,
//     manda o atual pro past.
//
// Por que esse shape em vez de "self-managed state"? React Flow
// faz centenas de mutações por segundo (movimento de mouse durante
// drag). Hook genérico que toma controle do state inteiro forçaria
// caller a sair do paradigma do React Flow. Em vez disso, caller
// decide QUANDO gravar (apenas em ações discretas: add, delete,
// duplicate, connect, patch).
//
// Tests: testes de comportamento em __tests__/use-flow-history.test.tsx.

import * as React from "react";

interface UseFlowHistoryOptions {
  /** Máximo de snapshots guardados (memória limitada). Default 30. */
  maxSize?: number;
}

export interface UseFlowHistoryReturn<T> {
  /** Grava um snapshot do estado ATUAL antes de mutar. Limpa future. */
  push: (currentSnapshot: T) => void;
  /** Desfaz: devolve estado anterior, manda o atual pro futuro. null se stack vazio. */
  undo: (currentSnapshot: T) => T | null;
  /** Refaz: devolve último desfeito, manda o atual pro past. null se futuro vazio. */
  redo: (currentSnapshot: T) => T | null;
  /** Limpa as 2 stacks (útil ao recarregar o flow). */
  reset: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useFlowHistory<T>({
  maxSize = 30,
}: UseFlowHistoryOptions = {}): UseFlowHistoryReturn<T> {
  const [past, setPast] = React.useState<T[]>([]);
  const [future, setFuture] = React.useState<T[]>([]);

  const push = React.useCallback(
    (currentSnapshot: T) => {
      setPast((p) => {
        const next = [...p, currentSnapshot];
        // FIFO: descarta os mais antigos quando passa do limite.
        return next.length > maxSize ? next.slice(next.length - maxSize) : next;
      });
      // Nova ação invalida tudo que estava no caminho de redo.
      setFuture([]);
    },
    [maxSize],
  );

  const undo = React.useCallback(
    (currentSnapshot: T): T | null => {
      if (past.length === 0) return null;
      const previous = past[past.length - 1];
      setPast((p) => p.slice(0, -1));
      setFuture((f) => [currentSnapshot, ...f]);
      return previous;
    },
    [past],
  );

  const redo = React.useCallback(
    (currentSnapshot: T): T | null => {
      if (future.length === 0) return null;
      const next = future[0];
      setFuture((f) => f.slice(1));
      setPast((p) => {
        const updated = [...p, currentSnapshot];
        return updated.length > maxSize
          ? updated.slice(updated.length - maxSize)
          : updated;
      });
      return next;
    },
    [future, maxSize],
  );

  const reset = React.useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  return {
    push,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
