"use client";

import * as React from "react";
import type { AgentActions } from "./actions";

const AgentActionsContext = React.createContext<AgentActions | null>(null);

export interface AgentActionsProviderProps {
  actions: AgentActions;
  children: React.ReactNode;
}

export function AgentActionsProvider({ actions, children }: AgentActionsProviderProps) {
  return (
    <AgentActionsContext.Provider value={actions}>
      {children}
    </AgentActionsContext.Provider>
  );
}

export function useAgentActions(): AgentActions {
  const ctx = React.useContext(AgentActionsContext);
  if (!ctx) {
    throw new Error(
      "useAgentActions deve ser usado dentro de <AgentActionsProvider />. Cada app (crm, admin) monta o provider com suas proprias server actions.",
    );
  }
  return ctx;
}
