"use client";

import { useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { useClientStore } from "@/lib/stores/client-store";
import { getGroups, syncGroups } from "@/actions/groups";
import { Users2, RefreshCw, Loader2, Link2 } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";

interface Group {
  id: string;
  organization_id: string;
  group_jid: string;
  name: string;
  participant_count: number;
  invite_link: string | null;
  created_at: string;
  updated_at: string;
}

function isContextError(error: string | undefined): boolean {
  if (!error) return false;
  return error.includes("Nenhum contexto ativo") ||
    error.includes("Contexto invalido") ||
    error.includes("sessao diferente");
}

export function GroupsPage() {
  const { activeOrgId, isManagingClient } = useActiveOrg();
  const clearClient = useClientStore((s) => s.clearClient);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  function handleContextExpired() {
    clearClient();
    toast.error("Contexto expirado. Selecione o cliente novamente.");
  }

  useEffect(() => {
    if (!isManagingClient) return;
    setLoading(true);
    getGroups()
      .then((data) => { setGroups(data as Group[]); setLoading(false); })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setLoading(false);
        if (isContextError(msg)) handleContextExpired();
        else toast.error("Erro ao carregar grupos: " + msg);
      });
  }, [activeOrgId]);

  async function handleSync() {
    if (!isManagingClient) return;
    setSyncing(true);
    try {
      const result = await syncGroups();
      if (result.error) {
        if (isContextError(result.error)) { handleContextExpired(); return; }
        toast.error(result.error);
      } else {
        toast.success(`${result.count} grupos sincronizados`);
        const data = await getGroups();
        setGroups(data as Group[]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isContextError(msg)) handleContextExpired();
      else toast.error("Erro ao sincronizar: " + msg);
    }
    setSyncing(false);
  }

  if (!isManagingClient) {
    return <NoContextFallback />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Grupos WhatsApp</h1>
          <p className="text-sm text-muted-foreground">{groups.length} grupos</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm font-medium disabled:opacity-50"
        >
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sincronizar
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/60">
          <Users2 className="size-10 mb-2 text-muted-foreground/30" />
          <p>Nenhum grupo encontrado</p>
          <p className="text-xs mt-1">Clique em Sincronizar para buscar grupos do WhatsApp</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => (
            <div key={group.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-foreground truncate">{group.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {group.participant_count} participantes
                  </p>
                </div>
                <div className="size-10 bg-emerald-600/20 rounded-xl flex items-center justify-center shrink-0">
                  <Users2 className="size-5 text-emerald-400" />
                </div>
              </div>
              {group.invite_link && (
                <a
                  href={group.invite_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1.5 text-xs text-primary hover:text-primary/80"
                >
                  <Link2 className="size-3" /> Link de convite
                </a>
              )}
              <p className="text-[10px] text-muted-foreground/60 mt-2">
                Atualizado: {new Date(group.updated_at).toLocaleString("pt-BR")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
