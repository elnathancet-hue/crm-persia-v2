"use client";

import { useEffect, useState } from "react";
import { useClientStore } from "@/lib/stores/client-store";
import { getOrganizations, switchAdminContext, clearAdminContextAction } from "@/actions/admin";
import { Building2, ChevronDown, X } from "lucide-react";

interface Org {
  id: string;
  name: string;
}

export function ClientSelector() {
  const { selectedClientId, selectedClientName, setClient, clearClient } = useClientStore();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getOrganizations().then((data) => {
      setOrgs(data.map((o: any) => ({ id: o.id, name: o.name })));
    });
  }, []);

  const filtered = orgs.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted hover:bg-muted transition-colors text-sm"
      >
        <Building2 className="size-4 text-muted-foreground" />
        <span className={selectedClientName ? "text-foreground" : "text-muted-foreground/60"}>
          {selectedClientName || "Selecionar cliente"}
        </span>
        <ChevronDown className="size-3 text-muted-foreground/60" />
      </button>

      {selectedClientId && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            await clearAdminContextAction();
            clearClient();
          }}
          className="absolute -top-1 -right-1 size-4 bg-primary rounded-full flex items-center justify-center hover:bg-primary/80"
        >
          <X className="size-2.5 text-white" />
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-72 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="p-2 border-b border-border">
              <input
                type="text"
                placeholder="Buscar cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-muted border border-border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary"
                autoFocus
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground/60 text-center">
                  Nenhum cliente encontrado
                </div>
              ) : (
                filtered.map((org) => (
                  <button
                    key={org.id}
                    onClick={async () => {
                      await switchAdminContext(org.id);
                      setClient(org.id, org.name);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${
                      org.id === selectedClientId
                        ? "text-primary bg-accent"
                        : "text-foreground"
                    }`}
                  >
                    {org.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
