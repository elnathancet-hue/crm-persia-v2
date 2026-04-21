"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getConversations,
  type ConversationFilter,
  type ConversationWithLead,
} from "@/actions/conversations";
import { useNotificationSound, useDesktopNotification } from "@/lib/hooks/use-notification";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Search, MessageSquare, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Helpers ----

const AVATAR_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-pink-500",
];

function hashColor(name: string | null): string {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin} min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) {
    return date.toLocaleDateString("pt-BR", { weekday: "short" });
  }
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

// Tags and queues loaded from DB at component level

// ---- Component ----

type ConversationListProps = {
  orgId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ConversationList({
  orgId,
  selectedId,
  onSelect,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<ConversationWithLead[]>(
    []
  );
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedQueues, setSelectedQueues] = useState<string[]>([]);
  const [dbTags, setDbTags] = useState<string[]>([]);
  const [dbQueues, setDbQueues] = useState<string[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSearchRef = useRef(search);
  const { play: playNotification } = useNotificationSound();
  const { notify: desktopNotify } = useDesktopNotification();

  const loadConversations = useCallback(
    async (searchTerm?: string) => {
      const term = searchTerm ?? debouncedSearchRef.current;
      const { data } = await getConversations(orgId, {
        filter,
        search: term || undefined,
      });
      if (data) {
        setConversations(data);
      }
      setLoading(false);
    },
    [orgId, filter]
  );

  // Load tags and queues from DB
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("tags")
      .select("name")
      .eq("organization_id", orgId)
      .order("name")
      .then(({ data }) => {
        if (data) setDbTags(data.map((t) => t.name));
      });
    supabase
      .from("queues")
      .select("name")
      .eq("organization_id", orgId)
      .then(({ data }) => {
        if (data) setDbQueues(data.map((q) => q.name));
      });
  }, [orgId]);

  // Initial load + when filter changes
  useEffect(() => {
    setLoading(true);
    loadConversations();
  }, [loadConversations]);

  // Supabase Realtime + polling fallback for conversation list
  useEffect(() => {
    let realtimeWorking = false;
    const supabase = createClient();

    const channel = supabase
      .channel("conv-list-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          realtimeWorking = true;
          const msg = payload.new as { sender?: string; content?: string; conversation_id?: string };
          loadConversations();

          if (msg.sender === "lead" && msg.conversation_id !== selectedId) {
            playNotification();
            desktopNotify("Nova mensagem", msg.content?.slice(0, 80) || "Nova mensagem recebida");
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          realtimeWorking = true;
          loadConversations();
        }
      )
      .subscribe();

    // Polling fallback: 5s if Realtime not working
    const interval = setInterval(() => {
      if (realtimeWorking) return;
      loadConversations();
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [orgId, selectedId, loadConversations, playNotification, desktopNotify]);

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => {
      debouncedSearchRef.current = search;
      loadConversations(search);
    }, 300);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [search, loadConversations]);

  // Apply local filters (unread)
  const filteredConversations = unreadOnly
    ? conversations.filter((c) => c.unread_count > 0)
    : conversations;

  const hasActiveFilters = unreadOnly || selectedTags.length > 0 || selectedQueues.length > 0;

  const handleClearFilters = () => {
    setUnreadOnly(false);
    setSelectedTags([]);
    setSelectedQueues([]);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const toggleQueue = (queue: string) => {
    setSelectedQueues((prev) =>
      prev.includes(queue) ? prev.filter((q) => q !== queue) : [...prev, queue]
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex h-14 items-center gap-2 border-b px-4">
        <MessageSquare className="size-5 text-primary" />
        <h2 className="text-sm font-semibold">Chat ao Vivo</h2>
        {/* Green pulsing dot = online */}
        <span className="relative ml-auto flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-green-500" />
        </span>
      </div>

      {/* Filter Tabs + Filter button */}
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Tabs
            defaultValue="all"
            onValueChange={(val) => setFilter((val ?? "all") as ConversationFilter)}
            className="flex-1"
          >
            <TabsList className="w-full">
              <TabsTrigger value="all" className="flex-1 text-xs">
                Todos
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex-1 text-xs">
                IA
              </TabsTrigger>
              <TabsTrigger value="waiting_human" className="flex-1 text-xs">
                Aguardando
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Popover open={filterPanelOpen} onOpenChange={setFilterPanelOpen}>
            <PopoverTrigger>
              <Button
                variant={hasActiveFilters ? "secondary" : "ghost"}
                size="icon-sm"
                title="Filtros"
                aria-label="Filtros"
                className="shrink-0"
              >
                <SlidersHorizontal className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-72 p-4">
              <div className="space-y-4">
                <h4 className="text-sm font-semibold">Filtros</h4>

                {/* Unread toggle */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</label>
                  <Button
                    variant={unreadOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setUnreadOnly(!unreadOnly)}
                    className="w-full justify-start rounded-md h-8 text-xs"
                  >
                    Não lidas
                  </Button>
                </div>

                {/* Tags */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {dbTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant={selectedTags.includes(tag) ? "default" : "secondary"}
                        className="cursor-pointer select-none rounded-md px-2 py-0.5 text-[11px] transition-colors hover:opacity-80"
                        onClick={() => toggleTag(tag)}
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Queues */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filas</label>
                  <div className="flex flex-wrap gap-1.5">
                    {dbQueues.map((queue) => (
                      <Badge
                        key={queue}
                        variant={selectedQueues.includes(queue) ? "default" : "secondary"}
                        className="cursor-pointer select-none rounded-md px-2 py-0.5 text-[11px] transition-colors hover:opacity-80"
                        onClick={() => toggleQueue(queue)}
                      >
                        {queue}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-8 text-xs"
                    onClick={() => {
                      handleClearFilters();
                      setFilterPanelOpen(false);
                    }}
                  >
                    Limpar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 h-8 text-xs"
                    onClick={() => setFilterPanelOpen(false)}
                  >
                    Aplicar
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Active filters indicator */}
      {hasActiveFilters && (
        <div className="shrink-0 flex items-center gap-2 border-b px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">Filtros:</span>
          {unreadOnly && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              Não lidas
            </Badge>
          )}
          {selectedTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="h-5 px-1.5 text-[10px]">
              {tag}
            </Badge>
          ))}
          {selectedQueues.map((queue) => (
            <Badge key={queue} variant="secondary" className="h-5 px-1.5 text-[10px]">
              {queue}
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleClearFilters}
            title="Limpar filtros"
            aria-label="Limpar filtros"
          >
            <X className="size-3" />
          </Button>
        </div>
      )}

      {/* Search */}
      <div className="shrink-0 border-b px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-sm"
          />
        </div>
      </div>

      {/* Conversation List - ONLY scrollable area */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <div className="size-12 rounded-xl bg-muted/50 flex items-center justify-center">
              <MessageSquare className="size-6 text-muted-foreground/60" />
            </div>
            <span className="text-sm">Nenhuma conversa encontrada</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredConversations.map((conv) => {
              const lead = conv.leads;
              const isSelected = conv.id === selectedId;
              const isAi = conv.assigned_to === "ai";
              const isWaiting = conv.status === "waiting_human";
              const colorClass = hashColor(lead?.name);

              return (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors cursor-pointer hover:bg-accent/50",
                    isSelected && "bg-accent"
                  )}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <Avatar size="default">
                      <AvatarFallback className={cn(colorClass, "text-white")}>
                        {getInitials(lead?.name)}
                      </AvatarFallback>
                    </Avatar>
                    {/* Status dot */}
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background",
                        isAi && "bg-blue-500",
                        isWaiting && "bg-amber-500",
                        !isAi && !isWaiting && "bg-green-500"
                      )}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {lead?.name || lead?.phone || "Sem nome"}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatRelativeTime(
                          conv.last_message?.created_at || conv.last_message_at
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {conv.last_message?.sender === "ai" && "IA: "}
                        {conv.last_message?.sender === "agent" && "Você: "}
                        {truncate(conv.last_message?.content, 50) ||
                          "Sem mensagens"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {conv.unread_count > 0 && (
                          <Badge
                            variant="default"
                            className="size-5 justify-center rounded-full px-0 text-[10px]"
                          >
                            {conv.unread_count}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {isAi && (
                        <Badge
                          variant="secondary"
                          className="h-4 px-1 text-[10px]"
                        >
                          IA
                        </Badge>
                      )}
                      {isWaiting && (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[10px] text-amber-600"
                        >
                          Aguardando
                        </Badge>
                      )}
                      <Badge
                        variant="secondary"
                        className="h-4 px-1 text-[10px] capitalize"
                      >
                        {conv.channel}
                      </Badge>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Filter panel is now a Popover inline above */}
    </div>
  );
}
