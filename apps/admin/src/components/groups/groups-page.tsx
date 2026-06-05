"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveOrg } from "@/lib/stores/client-store";
import { useClientStore } from "@/lib/stores/client-store";
import {
  getGroupMessages,
  getGroupParticipants,
  getGroups,
  syncGroups,
  type AdminGroupMessage,
  type AdminGroupParticipant,
} from "@/actions/groups";
import { Link2, Loader2, MessageSquare, Pin, RefreshCw, UserCheck, Users2, X } from "lucide-react";
import { NoContextFallback } from "@/components/no-context-fallback";
import { toast } from "sonner";
import { supportsCapability } from "@persia/shared";
import { adminGroupCapabilities } from "@/features/module-capabilities";

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
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [detailTab, setDetailTab] = useState<"messages" | "participants">("messages");
  const [detailLoading, setDetailLoading] = useState(false);
  const [messages, setMessages] = useState<AdminGroupMessage[]>([]);
  const [participants, setParticipants] = useState<AdminGroupParticipant[]>([]);
  const canSync = supportsCapability(adminGroupCapabilities, "sync_groups");
  const canReadMessages = supportsCapability(adminGroupCapabilities, "list_messages");
  const canReadParticipants = supportsCapability(adminGroupCapabilities, "list_participants");

  const handleContextExpired = useCallback(() => {
    clearClient();
    toast.error("Contexto expirado. Selecione o cliente novamente.");
  }, [clearClient]);

  useEffect(() => {
    if (!isManagingClient) return;
    getGroups()
      .then((data) => { setGroups(data as Group[]); setLoading(false); })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setLoading(false);
        if (isContextError(msg)) handleContextExpired();
        else toast.error("Erro ao carregar grupos: " + msg);
      });
  }, [activeOrgId, handleContextExpired, isManagingClient]);

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

  async function openGroup(group: Group) {
    setSelectedGroup(group);
    setDetailLoading(true);
    try {
      const [groupMessages, groupParticipants] = await Promise.all([
        canReadMessages ? getGroupMessages(group.id) : Promise.resolve([]),
        canReadParticipants ? getGroupParticipants(group.id) : Promise.resolve([]),
      ]);
      setMessages(groupMessages);
      setParticipants(groupParticipants);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar detalhes do grupo");
    } finally {
      setDetailLoading(false);
    }
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
        {canSync && <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-xl text-sm font-medium disabled:opacity-50"
        >
          {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Sincronizar
        </button>}
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
            <button
              key={group.id}
              type="button"
              onClick={() => openGroup(group)}
              className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/40 transition-colors"
            >
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
                <span className="mt-3 flex items-center gap-1.5 text-xs text-primary">
                  <Link2 className="size-3" /> Link de convite
                </span>
              )}
              <p className="text-[10px] text-muted-foreground/60 mt-2">
                Atualizado: {new Date(group.updated_at).toLocaleString("pt-BR")}
              </p>
            </button>
          ))}
        </div>
      )}

      {selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar detalhes"
            className="absolute inset-0 bg-black/60"
            onClick={() => setSelectedGroup(null)}
          />
          <section className="relative flex h-[min(760px,90vh)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold text-foreground">{selectedGroup.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {selectedGroup.participant_count} participantes sincronizados
                </p>
              </div>
              <button type="button" onClick={() => setSelectedGroup(null)} aria-label="Fechar">
                <X className="size-5 text-muted-foreground" />
              </button>
            </header>

            <div className="flex border-b border-border px-5">
              {canReadMessages && <button
                type="button"
                onClick={() => setDetailTab("messages")}
                className={`flex items-center gap-2 px-3 py-3 text-sm ${detailTab === "messages" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
              >
                <MessageSquare className="size-4" /> Mensagens ({messages.length})
              </button>}
              {canReadParticipants && <button
                type="button"
                onClick={() => setDetailTab("participants")}
                className={`flex items-center gap-2 px-3 py-3 text-sm ${detailTab === "participants" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
              >
                <Users2 className="size-4" /> Participantes ({participants.length})
              </button>}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {detailLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : detailTab === "messages" ? (
                <div className="space-y-3">
                  {messages.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mensagem persistida.</p>}
                  {messages.map((message) => (
                    <div key={message.id} className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
                        {message.sender_avatar_url || message.sender_lead?.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={message.sender_avatar_url || message.sender_lead?.avatar_url || ""} alt="" className="size-full object-cover" />
                        ) : (
                          (message.sender_lead?.name || message.sender_name || "?").slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1 rounded-lg border border-border bg-card p-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-semibold text-primary">
                            {message.sender_lead?.name || message.sender_name || message.sender_phone || "Remetente"}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            {message.is_pinned && <Pin className="size-3" />}
                            {new Date(message.created_at).toLocaleString("pt-BR")}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-foreground">{message.text || `[${message.media_type || "midia"}]`}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {participants.length === 0 && <p className="text-sm text-muted-foreground">Nenhum participante persistido.</p>}
                  {participants.map((participant) => (
                    <div key={participant.id} className="flex items-center gap-3 py-3">
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
                        {participant.avatar_url || participant.lead?.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={participant.avatar_url || participant.lead?.avatar_url || ""} alt="" className="size-full object-cover" />
                        ) : (
                          (participant.lead?.name || participant.name || participant.phone || "?").slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{participant.lead?.name || participant.name || participant.phone || "Participante"}</p>
                        <p className="text-xs text-muted-foreground">{participant.lead?.phone || participant.phone || "Telefone nao identificado"}</p>
                      </div>
                      {participant.lead && (
                        <span className="flex items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-xs text-success">
                          <UserCheck className="size-3" /> Lead
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
