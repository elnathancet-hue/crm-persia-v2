"use client";

import { createContext, useContext } from "react";

interface ShellContextValue {
  mode: "admin" | "client";
  clientOrgId: string | null;
  clientOrgName: string | null;
}

const ShellContext = createContext<ShellContextValue>({
  mode: "admin",
  clientOrgId: null,
  clientOrgName: null,
});

export function ShellProvider({
  mode,
  clientOrgId,
  clientOrgName,
  children,
}: ShellContextValue & { children: React.ReactNode }) {
  return (
    <ShellContext.Provider value={{ mode, clientOrgId, clientOrgName }}>
      {children}
    </ShellContext.Provider>
  );
}

export function useShellContext() {
  return useContext(ShellContext);
}
