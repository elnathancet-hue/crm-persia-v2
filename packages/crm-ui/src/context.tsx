"use client";

import * as React from "react";
import type { KanbanActions } from "./actions";

const KanbanActionsContext = React.createContext<KanbanActions | null>(null);

export interface KanbanProviderProps {
  actions: KanbanActions;
  children: React.ReactNode;
}

/**
 * Wraps the Kanban tree with the actions bag. Each app provides its own
 * implementation (auth-aware) so the shared components never import
 * server actions directly.
 */
export function KanbanProvider({ actions, children }: KanbanProviderProps) {
  return (
    <KanbanActionsContext.Provider value={actions}>
      {children}
    </KanbanActionsContext.Provider>
  );
}

export function useKanbanActions(): KanbanActions {
  const ctx = React.useContext(KanbanActionsContext);
  if (!ctx) {
    throw new Error(
      "useKanbanActions must be used inside <KanbanProvider actions={...}>",
    );
  }
  return ctx;
}
