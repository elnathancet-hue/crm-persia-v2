"use client";

import { useEffect, useState, useRef } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import {
  bulkApplyTagToConversationLeads,
  bulkMarkConversationsAsRead,
  bulkMoveConversationLeads,
  getConversations,
  type ConversationFilter,
  type ConversationWithLead,
} from "@/actions/conversations";
import { getTags } from "@/actions/tags";
import { getAllStagesForOrg } from "@/actions/pipelines";
import { useNotificationSound, useDesktopNotification } from "@/lib/hooks/use-notification";
import { useShellContext } from "@/lib/shell-context";
import { CheckCheck, ListChecks, Loader2, MessageSquare, Search, Tags, X } from "lucide-react";
import { toast } from "sonner";

import { hashColor, getInitials, formatRelativeTime } from "@/lib/utils";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type RealtimeMessagePayload = {
  sender?: string;
  content?: string | null;
  conversation_id?: string;
};

export function ConversationList({ selectedId, onSelect }: Props) {
  const { clientOrgId } = useShellContext();
  const [conversations, setConversations] = useState<ConversationWithLead[]>([]);
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refetchSignal, setRefetchSignal] = useState(0);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([]);
  const [tagId, setTagId] = useState("");
  const [stageId, setStageId] = useState("");
  const playSound = useNotificationSound();
  const desktopNotify = useDesktopNotification();

  // Ref captures "latest request" id for stale-response filtering
  const currentReqRef = useRef<symbol>(Symbol("init"));
  const conversationsRef = useRef(conversations);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Race-safe fetch: discard stale responses
  useEffect(() => {
    const reqId = Symbol("req");
    currentReqRef.current = reqId;
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
          const item = conversationsRef.current.find((conversation) => conversation.id === msg.conversation_id);
          const leadName = item?.leads?.name || item?.leads?.phone || "Novo contato";
          desktopNotify(`${leadName} lhe enviou uma mensagem`, msg.content || "Midia recebida");
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

  function enterBulkMode() {
    setBulkMode(true);
    Promise.all([getTags(), getAllStagesForOrg()])
      .then(([tagItems, stageItems]) => {
        setTags(tagItems.map((tag) => ({ id: tag.id, name: tag.name })));
        setStages(stageItems.map((stage) => ({ id: stage.id, name: stage.name })));
      })
      .catch(() => toast.error("Nao foi possivel carregar tags e etapas"));
  }

  function exitBulkMode() {
    setBulkMode(false);
    setBulkPanelOpen(false);
    setSelectedIds(new Set());
    setTagId("");
    setStageId("");
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulkAction(action: () => Promise<{ updated_count: number }>, success: string) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await action();
      toast.success(`${success}: ${result.updated_count}`);
      setRefetchSignal((value) => value + 1);
      exitBulkMode();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro na acao em massa");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60" aria-hidden />
          <input
            type="text"
            placeholder="Buscar nome, telefone ou mensagem..."
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
        <button
          type="button"
          onClick={bulkMode ? exitBulkMode : enterBulkMode}
          className={`ml-auto rounded-md p-1.5 ${bulkMode ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"}`}
          aria-label={bulkMode ? "Sair da selecao em massa" : "Selecionar conversas"}
          title={bulkMode ? "Sair da selecao em massa" : "Selecionar conversas"}
        >
          {bulkMode ? <X className="size-4" /> : <ListChecks className="size-4" />}
        </button>
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
                onClick={() => bulkMode ? toggleSelected(conv.id) : onSelect(conv.id)}
                className={`w-full text-left px-3 py-3 flex items-center gap-3 border-b border-card transition-colors ${
                  isSelected ? "bg-accent" : "hover:bg-muted"
                }`}
              >
                {bulkMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(conv.id)}
                    onChange={() => toggleSelected(conv.id)}
                    onClick={(event) => event.stopPropagation()}
                    className="size-4 shrink-0 accent-primary"
                    aria-label={`Selecionar ${lead.name || lead.phone || "conversa"}`}
                  />
                )}
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

      {bulkMode && (
        <div className="flex items-center gap-2 border-t border-border bg-card p-3">
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(conversations.map((conversation) => conversation.id)))}
            className="flex-1 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Selecionar todas
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setBulkPanelOpen(true)}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            <ListChecks className="size-4" /> Acoes ({selectedIds.size})
          </button>
        </div>
      )}

      {bulkPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/50" onClick={() => setBulkPanelOpen(false)} aria-label="Fechar acoes em massa" />
          <section className="relative w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-semibold">Acoes em massa</h2>
                <p className="text-sm text-muted-foreground">{selectedIds.size} conversas selecionadas</p>
              </div>
              <button type="button" onClick={() => setBulkPanelOpen(false)} aria-label="Fechar"><X className="size-5" /></button>
            </div>

            <div className="space-y-4">
              <button
                type="button"
                disabled={bulkBusy || selectedIds.size === 0}
                onClick={() => runBulkAction(() => bulkMarkConversationsAsRead([...selectedIds]), "Marcadas como lidas")}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-muted px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                <CheckCheck className="size-4" /> Marcar como lidas
              </button>

              <div className="space-y-2">
                <label className="text-xs font-medium">Adicionar tag</label>
                <div className="flex gap-2">
                  <select value={tagId} onChange={(event) => setTagId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <option value="">Escolha uma tag</option>
                    {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={bulkBusy || selectedIds.size === 0 || !tagId}
                    onClick={() => runBulkAction(() => bulkApplyTagToConversationLeads([...selectedIds], tagId), "Tag aplicada")}
                    className="rounded-md bg-primary px-3 py-2 text-white disabled:opacity-50"
                    aria-label="Aplicar tag"
                  >
                    <Tags className="size-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium">Mover para etapa</label>
                <div className="flex gap-2">
                  <select value={stageId} onChange={(event) => setStageId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <option value="">Escolha uma etapa</option>
                    {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={bulkBusy || selectedIds.size === 0 || !stageId}
                    onClick={() => runBulkAction(() => bulkMoveConversationLeads([...selectedIds], stageId), "Leads movidos")}
                    className="rounded-md bg-primary px-3 py-2 text-white disabled:opacity-50"
                    aria-label="Mover leads"
                  >
                    {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
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
