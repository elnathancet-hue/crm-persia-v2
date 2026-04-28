"use client";

import * as React from "react";
import type { LeadsActions } from "./actions";

const LeadsActionsContext = React.createContext<LeadsActions | null>(null);

export interface LeadsProviderProps {
  actions: LeadsActions;
  children: React.ReactNode;
}

export function LeadsProvider({ actions, children }: LeadsProviderProps) {
  return (
    <LeadsActionsContext.Provider value={actions}>
      {children}
    </LeadsActionsContext.Provider>
  );
}

export function useLeadsActions(): LeadsActions {
  const ctx = React.useContext(LeadsActionsContext);
  if (!ctx) {
    throw new Error(
      "useLeadsActions must be used inside <LeadsProvider actions={...}>",
    );
  }
  return ctx;
}
