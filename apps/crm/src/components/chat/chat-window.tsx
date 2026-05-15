"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNotificationSound, useDesktopNotification } from "@/lib/hooks/use-notification";
import { getConversation } from "@/actions/conversations";
import { assignConversation, closeConversation, markConversationAsRead, generateConversationSummary, scheduleMessage } from "@/actions/conversations";
import { getMessages, resendMessage, resolveMessageMediaUrl, type Message } from "@/actions/messages";
import { MessageInput } from "@/components/chat/message-input";
import { Avatar, AvatarFallback } from "@persia/ui/avatar";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@persia/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@persia/ui/dropdown-menu";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Calendar,
  Check,
  FileText,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Play,
  RotateCw,
  Sparkles,
  User,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---- Helpers ----

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return "Hoje";
  if (msgDate.getTime() === yesterday.getTime()) return "Ontem";
  return date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
  });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
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

function shouldResolveMediaUrl(mediaUrl: string | null): boolean {
  if (!mediaUrl) return false;
  return mediaUrl.startsWith("chat-media:") || mediaUrl.includes("/storage/v1/object/public/chat-media/");
}

// ---- Schedule Message Dialog ----

function ScheduleMessageDialog({
  open,
  onOpenChange,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
}) {
  const [messageText, setMessageText] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSchedule = async () => {
    if (!messageText.trim() || !scheduleDate) {
      toast.error("Preencha a mensagem e a data de envio");
      return;
    }
    setSaving(true);
    try {
      await scheduleMessage(conversationId, messageText.trim(), new Date(scheduleDate).toISOString());
      toast.success("Mensagem agendada!");
      setMessageText("");
      setScheduleDate("");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao agendar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agendar Mensagem</DialogTitle>
          <DialogDescription>
            A mensagem sera enviada automaticamente na data e hora escolhidas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Mensagem</label>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value.slice(0, 1000))}
              placeholder="Digite sua mensagem..."
              rows={4}
              className="w-full min-h-[80px] rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:ring-offset-2 outline-none resize-none"
            />
            <p className="text-[11px] text-muted-foreground text-right">
              {messageText.length}/1000
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Data e hora de envio</label>
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full h-10 rounded-md border bg-transparent px-3 text-sm focus:ring-2 focus:ring-primary focus:ring-offset-2 outline-none"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancelar
          </DialogClose>
          <Button onClick={handleSchedule} disabled={saving}>
            {saving ? "Agendando..." : "Agendar Mensagem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Transfer Dialog ----

function TransferDialog({
  open,
  onOpenChange,
  conversationId,
  orgId,
  onTransferToAi,
  onTransferToAgent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  orgId: string;
  onTransferToAi: () => void;
  onTransferToAgent: (userId: string) => void;
}) {
  const [agents, setAgents] = useState<Array<{ id: string; full_name: string }>>([]);
  const [queues, setQueues] = useState<Array<{ id: string; name: string }>>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    if (!open || loadedOnce) return;
    const supabase = createClient();

    // Fetch team members
    supabase
      .from("organization_members")
      .select("user_id, profiles(full_name)")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .then(({ data }) => {
        if (data) {
          setAgents(
            data.map((m: any) => ({
              id: m.user_id,
              full_name: m.profiles?.full_name || "Sem nome",
            }))
          );
        }
      });

    // Fetch queues (no soft-delete column on this table — was silently filtering
    // out every row because is_active does not exist on queues)
    supabase
      .from("queues")
      .select("id, name")
      .eq("organization_id", orgId)
      .then(({ data }) => {
        if (data) setQueues(data);
      });

    setLoadedOnce(true);
  }, [open, loadedOnce, orgId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir Conversa</DialogTitle>
          <DialogDescription>
            Escolha para quem deseja transferir esta conversa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Transfer to AI */}
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => {
              onTransferToAi();
              onOpenChange(false);
            }}
          >
            <Bot className="size-4 text-primary" />
            Transferir para IA
          </Button>

          {/* Transfer to agent */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Transferir para agente</label>
            {agents.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1">Nenhum agente na equipe</p>
            ) : (
              <div className="space-y-1">
                {agents.map((agent) => (
                  <Button
                    key={agent.id}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={() => {
                      onTransferToAgent(agent.id);
                      onOpenChange(false);
                    }}
                  >
                    <UserCheck className="size-4" />
                    {agent.full_name}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Transfer to queue */}
          {queues.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Transferir para fila</label>
              <div className="space-y-1">
                {queues.map((queue) => (
                  <Button
                    key={queue.id}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={async () => {
                      try {
                        const supabase = createClient();
                        await supabase
                          .from("conversations")
                          .update({ queue_id: queue.id, status: "waiting_human", assigned_to: null })
                          .eq("id", conversationId);
                        toast.success(`Transferido para fila ${queue.name}`);
                        onOpenChange(false);
                      } catch {
                        toast.error("Erro ao transferir");
                      }
                    }}
                  >
                    {queue.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancelar
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Component ----

type ChatWindowProps = {
  conversationId: string | null;
  orgId: string;
  onBack?: () => void;
};

export function ChatWindow({ conversationId, orgId, onBack }: ChatWindowProps) {
  const [conversation, setConversation] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [closing, setClosing] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const { play: playNotification } = useNotificationSound();
  const { notify: desktopNotify } = useDesktopNotification();

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleRetry = useCallback(async (messageId: string) => {
    setRetryingIds((prev) => {
      if (prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: "sending" } : m)));
    try {
      const { data, error } = await resendMessage(messageId);
      if (data) setMessages((prev) => prev.map((m) => (m.id === messageId ? data : m)));
      if (error) toast.error(`Falha ao reenviar: ${error}`);
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: "failed" } : m)));
      toast.error(e instanceof Error ? e.message : "Erro ao reenviar");
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  }, []);

  const withResolvedMediaUrl = useCallback(async (message: Message): Promise<Message> => {
    if (!shouldResolveMediaUrl(message.media_url)) return message;
    const result = await resolveMessageMediaUrl(message.id).catch(() => null);
    return result?.url ? { ...message, media_url: result.url } : message;
  }, []);

  // Load conversation + messages when selected conversation changes
  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      const [convResult, msgResult] = await Promise.all([
        getConversation(conversationId!),
        getMessages(conversationId!, { limit: 50 }),
      ]);

      if (cancelled) return;

      if (convResult.data) setConversation(convResult.data);
      if (msgResult.data) {
        setMessages(msgResult.data);
      }
      setLoading(false);

      // Mark as read when opening
      markConversationAsRead(conversationId!).catch(() => {});

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      }, 50);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Supabase Realtime: INSERT (new messages) + UPDATE (status transitions)
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          withResolvedMediaUrl(newMsg).then((resolvedMsg) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === resolvedMsg.id)) return prev;
              return [...prev, resolvedMsg];
            });
          });
          shouldAutoScroll.current = true;

          if (newMsg.sender === "lead") {
            playNotification();
            const leadName = (conversation as any)?.leads?.name || "Lead";
            desktopNotify("Nova mensagem", `${leadName}: ${newMsg.content?.slice(0, 80) || "Mídia"}`);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          withResolvedMediaUrl(updated).then((resolvedMsg) => {
            setMessages((prev) => prev.map((m) => (m.id === resolvedMsg.id ? resolvedMsg : m)));
          });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn("[realtime] chat-window subscribe status:", status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, conversation, playNotification, desktopNotify, withResolvedMediaUrl]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll.current && messages.length > 0) {
      scrollToBottom();
      shouldAutoScroll.current = false;
    }
  }, [messages, scrollToBottom]);

  const handleAssign = async () => {
    if (!conversationId) return;
    setAssigning(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await assignConversation(conversationId, user.id);
      const { data } = await getConversation(conversationId);
      if (data) setConversation(data);
    }
    setAssigning(false);
  };

  const handleResumeBot = async () => {
    if (!conversationId) return;
    setAssigning(true);
    await assignConversation(conversationId, "ai");
    const { data } = await getConversation(conversationId);
    if (data) setConversation(data);
    setAssigning(false);
    toast.success("Bot retomou a conversa");
  };

  const handleClose = async () => {
    if (!conversationId) return;
    setClosing(true);
    await closeConversation(conversationId);
    setClosing(false);
  };

  const handleMessageSent = (message: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
    shouldAutoScroll.current = true;
  };

  // Empty state
  if (!conversationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground px-8">
        <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center">
          <MessageSquare className="size-8 text-muted-foreground/60" />
        </div>
        <div className="text-center space-y-1">
          <span className="text-base font-semibold text-foreground">Selecione uma conversa</span>
          <p className="text-sm text-muted-foreground">
            Escolha uma conversa na lista ao lado para comecar
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const lead = (conversation as Record<string, unknown>)?.leads as Record<string, unknown> | undefined;
  const isAiHandling = conversation?.assigned_to === "ai";
  const isClosed = conversation?.status === "closed";
  const leadId = lead?.id as string | undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header - WhatsApp style with action bar */}
      <div className="shrink-0 flex h-16 items-center justify-between bg-card border-b px-4">
        <div className="flex items-center gap-3">
          {/* Back button for mobile */}
          {onBack && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              className="md:hidden"
              aria-label="Voltar"
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <Avatar size="default">
            <AvatarFallback>
              {getInitials(lead?.name as string | null)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">
                {(lead?.name as string) || "Sem nome"}
              </span>
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] capitalize"
              >
                {conversation?.channel as string}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="size-3" />
              <span>{(lead?.phone as string) || "Sem telefone"}</span>
            </div>
          </div>
        </div>

        {/* Action buttons bar */}
        <div className="flex items-center gap-2">
          {isAiHandling && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAssign}
              disabled={assigning}
            >
              {assigning ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <UserCheck className="mr-1.5 size-3.5" />
              )}
              Assumir
            </Button>
          )}

          {/* Play - Resume bot */}
          {!isAiHandling && !isClosed && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleResumeBot}
              disabled={assigning}
              className="size-8 rounded-lg"
              aria-label="Retomar bot"
            >
              {assigning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
            </Button>
          )}

          {/* Calendar - Schedule */}
          {!isClosed && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setScheduleOpen(true)}
              className="size-8 rounded-lg"
              title="Agendar mensagem"
              aria-label="Agendar mensagem"
            >
              <Calendar className="size-4" />
            </Button>
          )}

          {/* UserPlus - Transfer */}
          {!isClosed && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTransferOpen(true)}
              className="size-8 rounded-lg"
              title="Transferir conversa"
              aria-label="Transferir conversa"
            >
              <UserPlus className="size-4" />
            </Button>
          )}

          {/* More options dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon-sm" className="size-8 rounded-lg" aria-label="Mais opções">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="w-56">
              {leadId && (
                <DropdownMenuItem
                  onClick={() => {
                    window.open(`/leads/${leadId}`, "_blank");
                  }}
                >
                  <User className="size-4" />
                  Visualizar lead
                </DropdownMenuItem>
              )}
              {leadId && (
                <DropdownMenuItem
                  onClick={() => {
                    window.open(`/crm`, "_blank");
                  }}
                >
                  <FileText className="size-4" />
                  Ver no CRM
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setTransferOpen(true)}
              >
                <UserPlus className="size-4" />
                Transferir conversa
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  if (!conversationId) return;
                  setSummaryLoading(true);
                  const result = await generateConversationSummary(conversationId);
                  setSummaryLoading(false);
                  if (result.error) {
                    toast.error(result.error);
                  } else {
                    setSummaryText(result.summary);
                  }
                }}
                disabled={summaryLoading}
              >
                {summaryLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {summaryLoading ? "Gerando..." : "Resumo da conversa"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {!isClosed && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleClose}
                  disabled={closing}
                >
                  <X className="size-4" />
                  Fechar conversa
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages - WhatsApp style with subtle pattern background */}
      <div
        className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-16"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%234ade80' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          backgroundColor: "hsl(var(--background))",
        }}
      >
        <div className="flex flex-col gap-3 py-4 max-w-3xl mx-auto">
          {messages.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma mensagem ainda
            </div>
          )}
          {messages.map((msg, idx) => {
            const isLead = msg.sender === "lead";
            const isAi = msg.sender === "ai";
            const isAgent = msg.sender === "agent";

            // Date separator
            const showDateSeparator =
              idx === 0 ||
              !isSameDay(messages[idx - 1].created_at, msg.created_at);

            return (
              <div key={msg.id}>
                {/* Date separator */}
                {showDateSeparator && (
                  <div className="flex items-center justify-center py-4">
                    <span className="text-[11px] font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
                      {formatDateSeparator(msg.created_at)}
                    </span>
                  </div>
                )}

                {/* Message bubble - Lead LEFT, IA+Agent RIGHT */}
                <div
                  className={cn(
                    "flex max-w-[75%] flex-col gap-0.5",
                    isLead ? "items-start" : "ml-auto items-end"
                  )}
                >
                  {/* Sender label */}
                  {isAi && (
                    <div className="flex items-center gap-1 text-[11px] text-primary">
                      <Bot className="size-3" />
                      <span className="font-medium">IA</span>
                    </div>
                  )}
                  {isAgent && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <UserCheck className="size-3" />
                      <span className="font-medium">Você</span>
                    </div>
                  )}
                  {isLead && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <User className="size-3" />
                      <span>
                        {(lead?.name as string) ||
                          (lead?.phone as string) ||
                          "Lead"}
                      </span>
                    </div>
                  )}

                  {/* Bubble - WhatsApp style */}
                  <div
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-sm relative",
                      isAgent && msg.status === "failed"
                        ? "rounded-br-md bg-failure/90 text-failure-foreground border border-failure"
                        : isAgent && "rounded-br-md bg-primary text-primary-foreground",
                      isAi &&
                        "rounded-br-md bg-primary/15 text-foreground border border-primary/20",
                      isLead && "rounded-bl-md bg-card text-foreground border border-border",
                      isAgent && msg.status === "sending" && "opacity-70"
                    )}
                  >
                    {msg.media_url && msg.type === "image" && (
                      <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={msg.media_url}
                          alt=""
                          className="max-h-64 rounded-xl object-cover mb-1"
                        />
                      </a>
                    )}
                    {msg.media_url && msg.type === "audio" && (
                      <audio controls className="max-w-[250px] h-10 mb-1">
                        <source src={msg.media_url} />
                      </audio>
                    )}
                    {msg.media_url && msg.type === "video" && (
                      <video controls className="max-h-64 rounded-xl mb-1">
                        <source src={msg.media_url} />
                      </video>
                    )}
                    {msg.media_url && msg.type === "document" && (
                      <a
                        href={msg.media_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-primary hover:underline mb-1"
                      >
                        <FileText className="size-4" />
                        <span>Abrir documento</span>
                      </a>
                    )}
                    {msg.content && (
                      <p className="whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    )}
                    {/* Time + status inside bubble - WhatsApp style */}
                    <span className={cn(
                      "text-[10px] float-right ml-3 mt-1 inline-flex items-center gap-1",
                      isAgent ? "text-white/70" : "text-muted-foreground"
                    )}>
                      {formatMessageTime(msg.created_at)}
                      {isAgent && <StatusIndicator status={msg.status} onRetry={msg.status === "failed" ? () => handleRetry(msg.id) : undefined} isRetrying={retryingIds.has(msg.id)} />}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input - shrink-0 so it stays at bottom */}
      <div className="shrink-0">
        <MessageInput
          conversationId={conversationId}
          onMessageSent={handleMessageSent}
          disabled={isClosed}
        />
      </div>

      {/* Dialogs */}
      <ScheduleMessageDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        conversationId={conversationId}
      />
      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        conversationId={conversationId}
        orgId={orgId}
        onTransferToAi={handleResumeBot}
        onTransferToAgent={async (userId: string) => {
          await assignConversation(conversationId, userId);
          const { data } = await getConversation(conversationId);
          if (data) setConversation(data);
          toast.success("Transferido para agente");
        }}
      />

      {/* Summary dialog */}
      <Dialog open={!!summaryText} onOpenChange={() => setSummaryText(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5" />
              Resumo da Conversa
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap leading-relaxed">
            {summaryText}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (summaryText) {
                  navigator.clipboard.writeText(summaryText);
                  toast.success("Resumo copiado!");
                }
              }}
            >
              Copiar
            </Button>
            <DialogClose render={<Button />}>
              Fechar
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Status Indicator (WhatsApp-style ticks) ----

function StatusIndicator({
  status,
  onRetry,
  isRetrying,
}: {
  status: string;
  onRetry?: () => void;
  isRetrying: boolean;
}) {
  if (status === "sending" || isRetrying) {
    return <Loader2 className="size-3 animate-spin" aria-label="Enviando" />;
  }
  if (status === "failed") {
    return (
      <button
        type="button"
        onClick={onRetry}
        disabled={!onRetry}
        className="inline-flex items-center gap-0.5 text-white/90 hover:text-white transition-colors disabled:cursor-not-allowed"
        title="Reenviar mensagem"
        aria-label="Reenviar mensagem falhada"
      >
        <AlertCircle className="size-3" />
        <RotateCw className="size-3" />
      </button>
    );
  }
  return <Check className="size-3" aria-label="Enviado" />;
}
