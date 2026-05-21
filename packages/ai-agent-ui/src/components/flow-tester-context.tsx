"use client";

// PR 28 (mai/2026): FlowTesterContext — bridge entre TesterSheet e
// FlowCanvas pra UX de debug visual.
//
// Quando o cliente roda uma mensagem no Tester, o resultado contém
// `next_node_id` (onde o flow parou). Esse contexto compartilha esse
// id com o canvas pra que ele destaque visualmente o node em questão
// — um efeito de pulse animado por alguns segundos.
//
// Por que context (em vez de prop drilling):
//   - AgentEditor é o ancestral comum de TesterSheet e FlowCanvas.
//     Drillar prop por todo lugar polui assinaturas. Context isola
//     a feature.
//   - Múltiplos consumers no canvas (cada NodeView precisa saber se
//     "é o destacado"). Context dá acesso direto.
//
// Comportamento:
//   - setLastReachedNode(id) atualiza state + timestamp.
//   - useFlowTesterHighlight(nodeId) retorna boolean que vira true
//     por HIGHLIGHT_DURATION_MS quando esse node bateu com o último
//     reached. Auto-clears via setTimeout interno (evita ficar
//     destacado pra sempre).

import * as React from "react";

const HIGHLIGHT_DURATION_MS = 5000;

interface FlowTesterContextValue {
  lastReachedNodeId: string | null;
  /** Timestamp da última publicação. Usado pelos consumers pra calcular
   * se o highlight ainda deve estar visível (now - ts < duração). */
  lastReachedAt: number;
  /** TesterSheet chama isso após cada run pra publicar onde parou. */
  setLastReachedNode: (nodeId: string | null) => void;
}

const FlowTesterContext = React.createContext<FlowTesterContextValue | null>(
  null,
);

interface ProviderProps {
  children: React.ReactNode;
}

export function FlowTesterProvider({ children }: ProviderProps) {
  const [state, setState] = React.useState<{
    lastReachedNodeId: string | null;
    lastReachedAt: number;
  }>({ lastReachedNodeId: null, lastReachedAt: 0 });

  const setLastReachedNode = React.useCallback(
    (nodeId: string | null) => {
      setState({ lastReachedNodeId: nodeId, lastReachedAt: Date.now() });
    },
    [],
  );

  const value = React.useMemo<FlowTesterContextValue>(
    () => ({
      lastReachedNodeId: state.lastReachedNodeId,
      lastReachedAt: state.lastReachedAt,
      setLastReachedNode,
    }),
    [state, setLastReachedNode],
  );

  return (
    <FlowTesterContext.Provider value={value}>
      {children}
    </FlowTesterContext.Provider>
  );
}

/**
 * Hook usado por TesterSheet pra publicar onde o último run parou.
 * Devolve no-op quando fora do provider (Tester continua funcionando
 * standalone — só não destaca o canvas).
 */
export function useFlowTesterPublisher(): (nodeId: string | null) => void {
  const ctx = React.useContext(FlowTesterContext);
  // Identity stable quando ctx for null (memo).
  const noop = React.useCallback(() => {
    /* sem provider — Tester roda standalone */
  }, []);
  if (!ctx) return noop;
  return ctx.setLastReachedNode;
}

/**
 * Hook usado por cada NodeView pra saber se deve aparecer destacado.
 * Retorna boolean que vira true por HIGHLIGHT_DURATION_MS após o
 * Tester publicar esse nodeId. Self-clears via setTimeout interno.
 */
export function useFlowTesterHighlight(nodeId: string): boolean {
  const ctx = React.useContext(FlowTesterContext);
  const [highlighted, setHighlighted] = React.useState(false);

  React.useEffect(() => {
    if (!ctx) return;
    if (ctx.lastReachedNodeId !== nodeId) {
      setHighlighted(false);
      return;
    }
    // Bateu — liga highlight + agenda desligar.
    setHighlighted(true);
    const elapsed = Date.now() - ctx.lastReachedAt;
    const remaining = Math.max(0, HIGHLIGHT_DURATION_MS - elapsed);
    const timer = setTimeout(() => setHighlighted(false), remaining);
    return () => clearTimeout(timer);
  }, [ctx, nodeId, ctx?.lastReachedNodeId, ctx?.lastReachedAt]);

  return highlighted;
}
