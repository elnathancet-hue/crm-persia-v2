"use client";

import * as React from "react";
import type { AgendaActions, AgendaCallbacks } from "./actions";

const AgendaActionsContext = React.createContext<AgendaActions | null>(null);
const AgendaCallbacksContext = React.createContext<AgendaCallbacks>({});

export interface AgendaActionsProviderProps {
  actions: AgendaActions;
  callbacks?: AgendaCallbacks;
  children: React.ReactNode;
}

export function AgendaActionsProvider({
  actions,
  callbacks = {},
  children,
}: AgendaActionsProviderProps) {
  return (
    <AgendaActionsContext.Provider value={actions}>
      <AgendaCallbacksContext.Provider value={callbacks}>
        {children}
      </AgendaCallbacksContext.Provider>
    </AgendaActionsContext.Provider>
  );
}

export function useAgendaActions(): AgendaActions {
  const ctx = React.useContext(AgendaActionsContext);
  if (!ctx) {
    throw new Error(
      "useAgendaActions deve ser usado dentro de <AgendaActionsProvider />. Cada app (crm, admin) monta o provider com suas proprias server actions.",
    );
  }
  return ctx;
}

export function useAgendaCallbacks(): AgendaCallbacks {
  return React.useContext(AgendaCallbacksContext);
}
