"use client";

import { useEffect } from "react";
import { useClientStore } from "@/lib/stores/client-store";
import { ShellProvider } from "@/lib/shell-context";
import { AdminShell } from "@/components/shells/admin-shell";
import { ClientShell } from "@/components/shells/client-shell";

interface ShellSwitcherProps {
  mode: "admin" | "client";
  clientOrgId: string | null;
  clientOrgName: string | null;
  children: React.ReactNode;
}

export function ShellSwitcher({ mode, clientOrgId, clientOrgName, children }: ShellSwitcherProps) {
  const { selectedClientId, clearClient, setClient } = useClientStore();

  // Sync Zustand with server state on mount
  useEffect(() => {
    if (mode === "admin" && selectedClientId) {
      clearClient();
    } else if (mode === "client" && clientOrgId && clientOrgName && selectedClientId !== clientOrgId) {
      setClient(clientOrgId, clientOrgName);
    }
  }, [mode, clientOrgId, clientOrgName, selectedClientId, clearClient, setClient]);

  // Also sync synchronously on first render via localStorage
  // This ensures useActiveOrg().isManagingClient is correct before children mount
  useEffect(() => {
    if (mode === "client" && clientOrgId && clientOrgName) {
      const stored = JSON.parse(localStorage.getItem("admin-selected-client") || "{}");
      if (stored.state?.selectedClientId !== clientOrgId) {
        stored.state = { ...stored.state, selectedClientId: clientOrgId, selectedClientName: clientOrgName };
        localStorage.setItem("admin-selected-client", JSON.stringify(stored));
      }
    } else if (mode === "admin") {
      const stored = JSON.parse(localStorage.getItem("admin-selected-client") || "{}");
      if (stored.state?.selectedClientId) {
        stored.state = { ...stored.state, selectedClientId: null, selectedClientName: null };
        localStorage.setItem("admin-selected-client", JSON.stringify(stored));
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shell = mode === "client"
    ? <ClientShell>{children}</ClientShell>
    : <AdminShell>{children}</AdminShell>;

  return (
    <ShellProvider mode={mode} clientOrgId={clientOrgId} clientOrgName={clientOrgName}>
      {shell}
    </ShellProvider>
  );
}
