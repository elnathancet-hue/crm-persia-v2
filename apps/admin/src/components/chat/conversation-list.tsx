"use client";

import { useEffect, useState, useRef } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { getConversations, type ConversationFilter, type ConversationWithLead } from "@/actions/conversations";
import { useNotificationSound, useDesktopNotification } from "@/lib/hooks/use-notification";
import { useShellContext } from "@/lib/shell-context";
import { Search, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { hashColor, getInitials, formatRelativeTime } from "@/lib/utils";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type RealtimeMessagePayload = {
  sender?: string;
  content?: string | null;
};

export function ConversationList({ selectedId, onSelect }: Props) {
  const { clientOrgId } = useShellContext();
  const [conversations, setConversations] = useState<ConversationWithLead[]>([]);
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refetchSignal, setRefetchSignal] = useState(0);
  const playSound = useNotificationSound();
  const desktopNotify = useDesktopNotification();

  // Ref captures "latest request" id for stale-response filtering
  const currentReqRef = useRef<symbol>(Symbol("init"));

  // Race-safe fetch: discard stale responses
  useEffect(() => {
    const reqId = Symbol("req");
    currentReqRef.current = reqId;
    setLoading(true);
    getConversations({ filter, search: search || undefined })
      .then(({ data, error }) => {
        if (currentReqRef.current !== reqId) return;
        if (error) toast.error(error);
        else if (data) setConversations(data);
      })
      .catch((e) => {
        if (currentReqRef.current !== reqId) return;
        toast.error(e instanceof Error ? e.message : "Erro ao carregar conversas");
      })
      .finally(() => {
        if (currentReqRef.current === reqId) setLoading(false);
      });
  }, [filter, search, refetchSignal]);

  // Debounced search (300ms)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Realtime subscription (service_role bypasses RLS, scoped per org)
  useEffect(() => {
    if (!clientOrgId) return;
    const supabase = getRealtimeClient();
    const channel = supabase
      .channel(`admin-convos-${clientOrgId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "messages",
        filter: `organization_id=eq.${clientOrgId}`,
      }, (payload) => {
        const msg = payload.new as RealtimeMessagePayload;
        if (msg.sender === "lead") {
          playSound();
          desktopNotify("Nova mensagem", msg.content || "Midia recebida");
        }
        setRefetchSignal((s) => s + 1);
      })
      .on("postgres_changes", {
        event: "*", schema: "public", table: "conversations",
        filter: `organization_id=eq.${clientOrgId}`,
      }, () => {
        setRefetchSignal((s) => s + 1);
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn("[realtime] conversation-list subscribe status:", status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientOrgId, playSound, desktopNotify]);

  const filters: { label: string; value: ConversationFilter }[] = [
    { label: "Todas", value: "all" },
    { label: "IA", value: "ai" },
    { label: "Aguardando", value: "waiting_human" },
  ];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60" aria-hidden />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            aria-label="Buscar conversas"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground/60 outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-border" role="tablist" aria-label="Filtrar conversas">
        {filters.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === f.value
                ? "bg-primary text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-card"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" role="list" aria-label="Conversas">
        {loading ? (
          <ConversationListSkeleton />
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60">
            <MessageSquare className="size-8 mb-2 text-muted-foreground/30" aria-hidden />
            <p className="text-sm">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          conversations.map((conv) => {
            const lead = conv.leads;
            const isSelected = conv.id === selectedId;
            return (
              <button
                key={conv.id}
                role="listitem"
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelect(conv.id)}
                className={`w-full text-left px-3 py-3 flex items-center gap-3 border-b border-card transition-colors ${
                  isSelected ? "bg-accent" : "hover:bg-muted"
                }`}
              >
                <div className={`size-10 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0 ${hashColor(lead.name)}`}>
                  {getInitials(lead.name)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground truncate">
                      {lead.name || lead.phone || "Sem nome"}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-2">
                      {formatRelativeTime(conv.last_message_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-xs text-muted-foreground truncate">
                      {conv.last_message
                        ? `${conv.last_message.sender === "lead" ? "" : "Você: "}${conv.last_message.content || "[Mídia]"}`
                        : "Sem mensagens"}
                    </span>
                    {conv.unread_count > 0 && (
                      <span className="ml-2 shrink-0 bg-primary text-white text-[10px] font-bold rounded-full size-5 flex items-center justify-center" aria-label={`${conv.unread_count} não lidas`}>
                        {conv.unread_count > 99 ? "99+" : conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function ConversationListSkeleton() {
  return (
    <div className="divide-y divide-card" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-3 py-3 flex items-center gap-3 animate-pulse">
          <div className="size-10 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 bg-muted rounded" />
            <div className="h-2 w-1/2 bg-muted rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
