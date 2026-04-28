"use client";

import * as React from "react";
import type { SegmentsActions } from "./actions";

const SegmentsActionsContext = React.createContext<SegmentsActions | null>(
  null,
);

export interface SegmentsProviderProps {
  actions: SegmentsActions;
  children: React.ReactNode;
}

export function SegmentsProvider({
  actions,
  children,
}: SegmentsProviderProps) {
  return (
    <SegmentsActionsContext.Provider value={actions}>
      {children}
    </SegmentsActionsContext.Provider>
  );
}

export function useSegmentsActions(): SegmentsActions {
  const ctx = React.useContext(SegmentsActionsContext);
  if (!ctx) {
    throw new Error(
      "useSegmentsActions must be used inside <SegmentsProvider actions={...}>",
    );
  }
  return ctx;
}
