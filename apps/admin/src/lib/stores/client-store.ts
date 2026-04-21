import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEffect } from "react";
import { getOrCreateAdminOrg } from "@/actions/admin";

interface ClientStore {
  selectedClientId: string | null;
  selectedClientName: string | null;
  adminOrgId: string | null;
  adminOrgName: string | null;
  panelOpen: boolean;
  setClient: (id: string, name: string) => void;
  clearClient: () => void;
  setAdminOrg: (id: string, name: string) => void;
  togglePanel: () => void;
  closePanel: () => void;
}

export const useClientStore = create<ClientStore>()(
  persist(
    (set) => ({
      selectedClientId: null,
      selectedClientName: null,
      adminOrgId: null,
      adminOrgName: null,
      panelOpen: false,
      setClient: (id, name) => set({ selectedClientId: id, selectedClientName: name, panelOpen: false }),
      clearClient: () => set({ selectedClientId: null, selectedClientName: null }),
      setAdminOrg: (id, name) => set({ adminOrgId: id, adminOrgName: name }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      closePanel: () => set({ panelOpen: false }),
    }),
    {
      name: "admin-selected-client",
      partialize: (state) => ({
        selectedClientId: state.selectedClientId,
        selectedClientName: state.selectedClientName,
        adminOrgId: state.adminOrgId,
        adminOrgName: state.adminOrgName,
      }),
    }
  )
);

/** Returns the active org: selected client if managing a client, admin org otherwise */
export function useActiveOrg() {
  const { selectedClientId, selectedClientName, adminOrgId, adminOrgName, setAdminOrg } = useClientStore();

  useEffect(() => {
    if (!adminOrgId) {
      getOrCreateAdminOrg().then((org) => setAdminOrg(org.id, org.name)).catch(() => {});
    }
  }, [adminOrgId, setAdminOrg]);

  const isManagingClient = !!selectedClientId;
  const activeOrgId = selectedClientId || adminOrgId;
  const activeOrgName = selectedClientName || adminOrgName || "Admin Persia";

  return { activeOrgId, activeOrgName, isManagingClient };
}
