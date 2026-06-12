"use client";

import { useEffect, useState } from "react";
import { getOrganizations } from "@/actions/admin";
import { ClientsList } from "./clients-list";

export default function ClientsPage() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrganizations().then((o) => { setOrgs(o); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground mt-1">Gerencie as contas dos seus clientes</p>
      </div>
      <ClientsList initialOrgs={orgs} />
    </div>
  );
}
