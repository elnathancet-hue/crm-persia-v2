"use client";

import { useEffect, useState, useCallback, useMemo, useRef, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getConversations,
  bulkApplyTagToConversationLeads,
  bulkMarkConversationsAsRead,
  bulkMoveConversationLeads,
  type ConversationFilter,
  type ConversationWithLead,
} from "@/actions/conversations";
import { createLead } from "@/actions/leads";
import {
  listPipelinesForLead,
  listStagesForPipeline,
} from "@/actions/leads-kanban";
import { useNotificationSound, useDesktopNotification } from "@/lib/hooks/use-notification";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Checkbox } from "@persia/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@persia/ui/tabs";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@persia/ui/popover";
import {
  Archive,
  Bell,
  BellOff,
  CheckCheck,
  GitBranch,
  Loader2,
  MessageSquare,
  Search,
  SlidersHorizontal,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---- Helpers ----

// NOTA: paleta intencional (hash do nome -> 1 de 10 cores) — nao e
// hardcode visual a corrigir. 10 cores distintas exigem variedade alem
// dos tokens semanticos. Mesmo padrao de KanbanBoard/LeadsList/
// LeadCommentsTab. Identidade visual, nao semantica.
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

type LeadTag = {
  id: string;
  name: string;
  color: string | null;
};

type QueueOption = {
  id: string;
  name: string;
};

type PipelineOption = {
  id: string;
  name: string;
};

type StageOption = {
  id: string;
  name: string;
  color: string;
};

function getLeadTags(lead: ConversationWithLead["leads"] | null | undefined): LeadTag[] {
  return (lead?.lead_tags ?? [])
    .map((lt) => lt.tags)
    .filter((tag): tag is LeadTag => Boolean(tag?.id && tag?.name));
}

function tagPillStyle(color: string | null | undefined): CSSProperties {
  if (!color) return {};
  return {
    backgroundColor: `${color}1A`,
    borderColor: `${color}55`,
    color,
  };
}

// Tags and queues loaded from DB at component level

// ---- Component ----

type ConversationListProps = {
  orgId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Dados prefetchados pelo page.tsx SSR — evita spinner inicial */
  initialConversations?: ConversationWithLead[];
};

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-label="WhatsApp">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export function ConversationList({
  orgId,
  selectedId,
  onSelect,
  initialConversations,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<ConversationWithLead[]>(
    initialConversations ?? []
  );
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [search, setSearch] = useState("");
  // Se temos dados SSR, não mostra spinner: lista já está visível.
  const [loading, setLoading] = useState(!initialConversations);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedQueues, setSelectedQueues] = useState<string[]>([]);
  const [dbTags, setDbTags] = useState<LeadTag[]>([]);
  const [dbQueues, setDbQueues] = useState<QueueOption[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [leadSaving, setLeadSaving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTagId, setBulkTagId] = useState("");
  const [bulkPipelineId, setBulkPipelineId] = useState("");
  const [bulkStageId, setBulkStageId] = useState("");
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [stages, setStages] = useState<StageOption[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSearchRef = useRef(search);
  const conversationsRef = useRef(conversations);
  const onSelectRef = useRef(onSelect);
  const playNotificationRef = useRef<() => void>(() => {});
  const desktopNotifyRef = useRef<(title: string, body: string) => void>(() => {});
  const {
    play: playNotification,
    enabled: soundEnabled,
    setEnabled: setSoundEnabled,
  } = useNotificationSound();
  const {
    notify: desktopNotify,
    enabled: desktopNotificationsEnabled,
    setEnabled: setDesktopNotificationsEnabled,
  } = useDesktopNotification();

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => { playNotificationRef.current = playNotification; }, [playNotification]);
  useEffect(() => { desktopNotifyRef.current = desktopNotify; }, [desktopNotify]);

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

  // Debounce: agrupa múltiplos eventos realtime em burst num único reload (150ms)
  const debouncedLoad = useCallback(() => {
    if (loadDebounceRef.current) clearTimeout(loadDebounceRef.current);
    loadDebounceRef.current = setTimeout(() => loadConversations(), 150);
  }, [loadConversations]);

  // Load tags and queues from DB
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("tags")
      .select("id, name, color")
      .eq("organization_id", orgId)
      .order("name")
      .then(({ data }) => {
        if (data) setDbTags(data as LeadTag[]);
      });
    supabase
      .from("queues")
      .select("id, name")
      .eq("organization_id", orgId)
      .then(({ data }) => {
        if (data) setDbQueues(data as QueueOption[]);
      });
  }, [orgId]);

  useEffect(() => {
    listPipelinesForLead()
      .then((items) => setPipelines(items))
      .catch(() => setPipelines([]));
  }, []);

  useEffect(() => {
    setBulkStageId("");
    setStages([]);
    if (!bulkPipelineId) return;
    listStagesForPipeline(bulkPipelineId)
      .then((items) => setStages(items))
      .catch(() => setStages([]));
  }, [bulkPipelineId]);

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
          const msg = payload.new as { sender?: string; conversation_id?: string; content?: string };
          if (msg.sender && msg.sender !== "agent") {
            playNotificationRef.current();
            const conv = conversationsRef.current.find((c) => c.id === msg.conversation_id);
            const lead = conv?.leads as { name?: string | null; phone?: string | null } | null | undefined;
            const leadName = lead?.name ?? lead?.phone ?? "Nova mensagem";
            const preview = typeof msg.content === "string" && msg.content.trim()
              ? msg.content.slice(0, 80)
              : "Nova mensagem";
            desktopNotifyRef.current(leadName, preview);
          }
          debouncedLoad();
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
          debouncedLoad();
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeWorking = false;
        }
      });

    // Polling fallback: 5s if Realtime not working
    const interval = setInterval(() => {
      if (realtimeWorking) return;
      loadConversations();
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [orgId, debouncedLoad]); // selectedId intencionalmente fora: nao e usado no effect

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

  const filteredConversations = useMemo(
    () =>
      conversations.filter((conversation) => {
        if (unreadOnly && conversation.unread_count <= 0) return false;
        if (
          selectedTags.length > 0 &&
          !getLeadTags(conversation.leads).some((tag) => selectedTags.includes(tag.id))
        ) {
          return false;
        }
        if (
          selectedQueues.length > 0 &&
          (!conversation.queue_id || !selectedQueues.includes(conversation.queue_id))
        ) {
          return false;
        }
        return true;
      }),
    [conversations, selectedQueues, selectedTags, unreadOnly],
  );

  const hasActiveFilters = unreadOnly || selectedTags.length > 0 || selectedQueues.length > 0;

  const handleClearFilters = () => {
    setUnreadOnly(false);
    setSelectedTags([]);
    setSelectedQueues([]);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const toggleQueue = (queueId: string) => {
    setSelectedQueues((prev) =>
      prev.includes(queueId) ? prev.filter((q) => q !== queueId) : [...prev, queueId]
    );
  };

  const selectableConversationIds = useMemo(
    () => filteredConversations.map((conversation) => conversation.id),
    [filteredConversations],
  );
  const selectedCount = selectedConversationIds.size;
  const selectedTagName = dbTags.find((tag) => tag.id === bulkTagId)?.name;
  const selectedPipelineName = pipelines.find((pipeline) => pipeline.id === bulkPipelineId)?.name;
  const selectedStageName = stages.find((stage) => stage.id === bulkStageId)?.name;
  const hasBulkChanges = Boolean(bulkTagId || bulkStageId);

  useEffect(() => {
    setSelectedConversationIds(new Set());
  }, [filter, search, unreadOnly, selectedTags, selectedQueues]);

  useEffect(() => {
    const visibleIds = new Set(selectableConversationIds);
    setSelectedConversationIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [selectableConversationIds]);

  const toggleConversationSelection = (conversationId: string) => {
    setSelectedConversationIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedConversationIds((prev) => {
      const allSelected =
        selectableConversationIds.length > 0 &&
        selectableConversationIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(selectableConversationIds);
    });
  };

  const exitBulkMode = () => {
    setBulkMode(false);
    setSelectedConversationIds(new Set());
    setBulkTagId("");
    setBulkPipelineId("");
    setBulkStageId("");
  };

  const runBulkAction = async (action: () => Promise<{ updated_count: number }>, successLabel: string) => {
    if (selectedCount === 0) {
      toast.error("Selecione pelo menos uma conversa");
      return;
    }
    setBulkBusy(true);
    try {
      const result = await action();
      toast.success(`${successLabel}: ${result.updated_count}`);
      setSelectedConversationIds(new Set());
      await loadConversations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel concluir a acao");
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkChanges = async () => {
    if (selectedCount === 0) {
      toast.error("Selecione pelo menos uma conversa");
      return;
    }
    if (!hasBulkChanges) {
      toast.error("Escolha uma tag ou uma etapa do funil");
      return;
    }

    setBulkBusy(true);
    try {
      const conversationIds = [...selectedConversationIds];
      const results: string[] = [];

      if (bulkTagId) {
        const result = await bulkApplyTagToConversationLeads(conversationIds, bulkTagId);
        results.push(`tag em ${result.updated_count}`);
      }

      if (bulkStageId) {
        const result = await bulkMoveConversationLeads(conversationIds, bulkStageId);
        results.push(`funil em ${result.updated_count}`);
      }

      toast.success(`Alterações aplicadas: ${results.join(" | ")}`);
      setSelectedConversationIds(new Set());
      setBulkTagId("");
      setBulkPipelineId("");
      setBulkStageId("");
      setBulkMode(false);
      await loadConversations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel aplicar as alteracoes");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleCreateLead = async (formData: FormData) => {
    setLeadSaving(true);
    try {
      await createLead(formData);
      toast.success("Lead criado");
      setLeadDialogOpen(false);
      await loadConversations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel criar o lead");
    } finally {
      setLeadSaving(false);
    }
  };

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: "var(--chat-sidebar-bg)" }}
    >
      {/* Header */}
      <div
        className="flex h-[59px] shrink-0 items-center gap-3 border-b border-[color:var(--chat-sidebar-divider)] px-4"
        style={{ background: "var(--chat-header-bg)" }}
      >
        <MessageSquare className="size-5 text-[color:var(--chat-send-bg)]" />
        <h2 className="text-base font-medium text-[color:var(--chat-header-fg)]">Conversas</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={desktopNotificationsEnabled ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setDesktopNotificationsEnabled(!desktopNotificationsEnabled)}
            title={desktopNotificationsEnabled ? "Desativar avisos laterais" : "Ativar avisos laterais"}
            aria-label={desktopNotificationsEnabled ? "Desativar avisos laterais" : "Ativar avisos laterais"}
            className="size-8"
          >
            {desktopNotificationsEnabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </Button>
          <Button
            variant={soundEnabled ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? "Desativar som" : "Ativar som"}
            aria-label={soundEnabled ? "Desativar som" : "Ativar som"}
            className="size-8"
          >
            {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setLeadDialogOpen(true)}
            title="Criar lead"
            aria-label="Criar lead"
            className="size-8"
          >
            <UserPlus className="size-4" />
          </Button>
          <Button
            variant={bulkMode ? "secondary" : "ghost"}
            size="sm"
            onClick={() => (bulkMode ? exitBulkMode() : setBulkMode(true))}
            title={bulkMode ? "Sair da seleção em massa" : "Seleção em massa"}
            aria-label={bulkMode ? "Sair da seleção em massa" : "Seleção em massa"}
            className="h-8 gap-1.5 rounded-lg px-2"
          >
            <CheckCheck className="size-4" />
            <span className="hidden text-xs sm:inline">
              {bulkMode ? "Cancelar" : "Selecionar"}
            </span>
          </Button>
        </div>
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/70 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-success" />
        </span>
      </div>

      {/* Filter Tabs + Filter button */}
      <div className="shrink-0 border-b border-[color:var(--chat-sidebar-divider)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Tabs
            defaultValue="all"
            onValueChange={(val) => setFilter((val ?? "all") as ConversationFilter)}
            className="flex-1"
          >
            <TabsList className="h-9 w-full rounded-lg bg-[color:var(--chat-input-field-bg)] p-1">
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
                        key={tag.id}
                        variant={selectedTags.includes(tag.id) ? "default" : "secondary"}
                        className="cursor-pointer select-none rounded-md px-2 py-0.5 text-[11px] transition-colors hover:opacity-80"
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.name}
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
                        key={queue.id}
                        variant={selectedQueues.includes(queue.id) ? "default" : "secondary"}
                        className="cursor-pointer select-none rounded-md px-2 py-0.5 text-[11px] transition-colors hover:opacity-80"
                        onClick={() => toggleQueue(queue.id)}
                      >
                        {queue.name}
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
          {selectedTags.map((tagId) => (
            <Badge key={tagId} variant="secondary" className="h-5 px-1.5 text-[10px]">
              {dbTags.find((tag) => tag.id === tagId)?.name ?? "Tag"}
            </Badge>
          ))}
          {selectedQueues.map((queueId) => (
            <Badge key={queueId} variant="secondary" className="h-5 px-1.5 text-[10px]">
              {dbQueues.find((queue) => queue.id === queueId)?.name ?? "Fila"}
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
      <div className="shrink-0 border-b border-[color:var(--chat-sidebar-divider)] px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="chat_conversation_search"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-lg border-0 bg-[color:var(--chat-input-field-bg)] pl-8 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-[color:var(--chat-send-bg)]"
          />
        </div>
      </div>

      {/* Conversation List - ONLY scrollable area */}
      <div className={cn("flex-1 overflow-y-auto", bulkMode && "pb-40")}>
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
              const isBulkSelected = selectedConversationIds.has(conv.id);
              const isAi = conv.assigned_to === "ai";
              const isWaiting = conv.status === "waiting_human" && conv.unread_count > 0;
              const colorClass = hashColor(lead?.name);
              const leadTags = getLeadTags(lead);

              return (
                <div
                  key={conv.id}
                  className={cn(
                    "flex min-h-[72px] w-full cursor-pointer items-start gap-3 border-b border-[color:var(--chat-sidebar-divider)] px-3 py-2.5 text-left transition-colors",
                    isBulkSelected && "border-l-4 border-l-primary bg-primary/5 pl-2"
                  )}
                  style={{
                    background: isBulkSelected
                      ? undefined
                      : isSelected
                      ? "var(--chat-sidebar-active)"
                      : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isBulkSelected) {
                      e.currentTarget.style.background =
                        "var(--chat-sidebar-hover)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isBulkSelected) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  {bulkMode && (
                    <div className="flex h-10 shrink-0 items-center">
                      <Checkbox
                        checked={isBulkSelected}
                        onCheckedChange={() => toggleConversationSelection(conv.id)}
                        aria-label={`Selecionar conversa de ${lead?.name || lead?.phone || "lead"}`}
                      />
                    </div>
                  )}
                  {/* Avatar — Bug A fix (mai/2026): foto WhatsApp via
                      lead.avatar_url (populado pelo pipeline UAZAPI).
                      Fallback de iniciais permanece se não houver foto. */}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => (bulkMode ? toggleConversationSelection(conv.id) : onSelect(conv.id))}
                    className="relative h-auto shrink-0 rounded-full p-0"
                    aria-label={`Abrir conversa de ${lead?.name || lead?.phone || "lead"}`}
                  >
                    <Avatar size="default">
                      {lead?.avatar_url ? (
                        <AvatarImage
                          src={lead.avatar_url}
                          alt={lead?.name ?? undefined}
                        />
                      ) : null}
                      <AvatarFallback className={cn(colorClass, "text-white")}>
                        {getInitials(lead?.name)}
                      </AvatarFallback>
                    </Avatar>
                    {/* Status dot */}
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background",
                        isAi && "bg-primary",
                        isWaiting && "bg-warning",
                        !isAi && !isWaiting && "bg-success"
                      )}
                    />
                  </Button>

                  {/* Content */}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => (bulkMode ? toggleConversationSelection(conv.id) : onSelect(conv.id))}
                    className="h-auto min-w-0 flex-1 flex-col items-stretch gap-1 rounded-none p-0 text-left hover:bg-transparent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[15px] font-medium leading-5 text-[color:var(--chat-header-fg)]">
                          {lead?.name || lead?.phone || "Sem nome"}
                        </span>
                        {conv.channel === "whatsapp" ? (
                          <WhatsAppIcon className="size-4 shrink-0 text-success" />
                        ) : (
                          <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px] capitalize">
                            {conv.channel}
                          </Badge>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatRelativeTime(
                          conv.last_message?.created_at || conv.last_message_at
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] leading-5 text-muted-foreground">
                        {conv.last_message?.sender === "ai" && "IA: "}
                        {conv.last_message?.sender === "agent" && "Você: "}
                        {truncate(conv.last_message?.content?.replace(/[*_~`]/g, ""), 50) ||
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
                          className="h-4 px-1 text-[10px] text-warning"
                        >
                          Aguardando
                        </Badge>
                      )}
                      {leadTags.slice(0, 3).map((tag) => (
                        <Badge
                          key={tag.id}
                          variant="outline"
                          className="h-5 max-w-[92px] truncate rounded-md border px-1.5 text-[10px]"
                          style={tagPillStyle(tag.color)}
                        >
                          {tag.name}
                        </Badge>
                      ))}
                      {leadTags.length > 3 && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          +{leadTags.length - 3}
                        </Badge>
                      )}
                    </div>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {bulkMode && (
        <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-2xl border-t-2 border-primary/40 bg-background/98 px-4 py-4 shadow-[0_-12px_36px_rgba(15,23,42,0.16)] backdrop-blur supports-[backdrop-filter]:bg-background/90 animate-in slide-in-from-bottom-4 fade-in-0 duration-200">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {selectedCount === 0
                  ? "Modo seleção ativo"
                  : selectedCount === 1
                    ? "1 conversa selecionada"
                    : `${selectedCount} conversas selecionadas`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {selectedCount === 0
                  ? "Toque nas conversas da lista para selecionar."
                  : "As ações serão aplicadas somente às conversas selecionadas."}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0"
              onClick={exitBulkMode}
              disabled={bulkBusy}
            >
              Cancelar
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={toggleSelectAll}
                disabled={filteredConversations.length === 0 || bulkBusy}
              >
                {selectedCount === selectableConversationIds.length && selectableConversationIds.length > 0 ? "Desmarcar visíveis" : "Selecionar visíveis"}
              </Button>
              <div className="h-4 w-px bg-border mx-1" />
              
              <Popover>
                <PopoverTrigger render={(props: React.HTMLAttributes<HTMLButtonElement>) => (
                  <Button {...(props as any)} variant="secondary" size="sm" className="h-8" disabled={selectedCount === 0 || bulkBusy}>
                    <GitBranch className="mr-1.5 size-3.5" />
                    Ações em lote
                  </Button>
                )} />
                <PopoverContent side="top" align="end" className="w-80 p-3 space-y-4 shadow-xl">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Ações rápidas</Label>
                    <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" disabled title="Em breve">
                      <Archive className="mr-1.5 size-3.5" />
                      Arquivar
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={bulkBusy || selectedCount === 0}
                      onClick={() => runBulkAction(() => bulkMarkConversationsAsRead([...selectedConversationIds]), "Marcadas como lidas")}
                    >
                      {bulkBusy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <CheckCheck className="mr-1.5 size-3.5" />}
                      Marcar lido
                    </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Adicionar tag</Label>
                    <Select value={bulkTagId} onValueChange={(value) => setBulkTagId(value ?? "")}>
                      <SelectTrigger className="h-8 text-xs">
                        <span className={cn("flex-1 truncate text-left", !bulkTagId && "text-muted-foreground")}>
                          {bulkTagId ? (selectedTagName ?? "Tag") : "Escolha uma tag..."}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {dbTags.map((tag) => (
                          <SelectItem key={tag.id} value={tag.id} className="text-xs">{tag.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Mover para funil</Label>
                    <div className="flex gap-2">
                      <Select value={bulkPipelineId} onValueChange={(value) => setBulkPipelineId(value ?? "")}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <span className={cn("truncate text-left", !bulkPipelineId && "text-muted-foreground")}>
                            {bulkPipelineId ? (selectedPipelineName ?? "Funil") : "Funil"}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {pipelines.map((pipeline) => (
                            <SelectItem key={pipeline.id} value={pipeline.id} className="text-xs">{pipeline.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={bulkStageId} onValueChange={(value) => setBulkStageId(value ?? "")} disabled={!bulkPipelineId}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <span className={cn("truncate text-left", !bulkStageId && "text-muted-foreground")}>
                            {bulkStageId ? (selectedStageName ?? "Etapa") : "Etapa"}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id} className="text-xs">{stage.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button size="sm" className="w-full" disabled={bulkBusy || selectedCount === 0 || !hasBulkChanges} onClick={runBulkChanges}>
                    {bulkBusy && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                    Aplicar alterações
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      )}

      <Dialog open={leadDialogOpen} onOpenChange={setLeadDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Criar novo lead</DialogTitle>
            <DialogDescription>
              Cadastre um contato manualmente para iniciar o atendimento pelo CRM.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateLead(new FormData(event.currentTarget));
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="chat-lead-name">Nome</Label>
                <Input id="chat-lead-name" name="name" placeholder="Nome do lead" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat-lead-phone">Telefone</Label>
                <Input id="chat-lead-phone" name="phone" placeholder="(11) 98765-4321" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat-lead-email">E-mail</Label>
                <Input id="chat-lead-email" name="email" type="email" placeholder="email@exemplo.com" />
              </div>
              <div className="space-y-2">
                <Label>Origem</Label>
                <Select name="source" defaultValue="manual">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="website">Website</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Canal</Label>
                <Select name="channel" defaultValue="whatsapp">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="telefone">Telefone</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <input type="hidden" name="status" value="new" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLeadDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={leadSaving}>
                {leadSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <UserPlus className="mr-2 size-4" />}
                Criar lead
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Filter panel is now a Popover inline above */}
    </div>
  );
}
