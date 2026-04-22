"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { getRealtimeClient } from "@/lib/supabase";
import { getConversation, closeConversation, assignConversation, markConversationAsRead } from "@/actions/conversations";
import { getMessages, sendMessageViaWhatsApp, sendMediaViaWhatsApp, resendMessage, getWhatsAppConnectionStatus, resolveMessageMediaUrl, type Message } from "@/actions/messages";
import { MessageInput } from "@/components/chat/message-input";
import { ArrowLeft, Bot, Loader2, MoreHorizontal, X, FileText, Video, Mic, Download, Check, AlertCircle, RotateCw } from "lucide-react";
import { useClientStore } from "@/lib/stores/client-store";
import { toast } from "sonner";

function isContextError(error: string | undefined): boolean {
  if (!error) return false;
  return error.includes("Nenhum contexto ativo") ||
    error.includes("Contexto invalido") ||
    error.includes("Contexto expirado") ||
    error.includes("sessao diferente");
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (msgDate.getTime() === today.getTime()) return "Hoje";
  if (msgDate.getTime() === yesterday.getTime()) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

import { hashColor, getInitials } from "@/lib/utils";

interface Props {
  conversationId: string;
  onBack: () => void;
}

type ConversationLead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  channel: string;
};

type ConversationDetail = {
  id: string;
  organization_id: string;
  lead_id: string;
  channel: string;
  status: string;
  assigned_to: string;
  queue_id: string | null;
  ai_summary: string | null;
  unread_count: number;
  last_message_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  leads: ConversationLead | null;
};

const AUTO_SCROLL_THRESHOLD_PX = 120;

function shouldResolveMediaUrl(mediaUrl: string | null): boolean {
  if (!mediaUrl) return false;
  return mediaUrl.startsWith("chat-media:") || mediaUrl.includes("/storage/v1/object/public/chat-media/");
}

export function ChatWindow({ conversationId, onBack }: Props) {
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const clearClient = useClientStore((s) => s.clearClient);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  function handleContextExpired() {
    clearClient();
    toast.error("Contexto expirado. Selecione o cliente novamente.");
    onBack();
  }

  const withResolvedMediaUrl = useCallback(async (message: Message): Promise<Message> => {
    if (!shouldResolveMediaUrl(message.media_url)) return message;
    const result = await resolveMessageMediaUrl(message.id).catch(() => null);
    return result?.url ? { ...message, media_url: result.url } : message;
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getConversation(conversationId),
      getMessages(conversationId),
    ]).then(([convResult, msgResult]) => {
      if (!isMountedRef.current) return;
      if (convResult.data) setConversation(convResult.data as ConversationDetail);
      if (msgResult.data) setMessages(msgResult.data);
      setLoading(false);
    }).catch(() => {
      if (!isMountedRef.current) return;
      setLoading(false);
      toast.error("Erro ao carregar conversa");
    });

    markConversationAsRead(conversationId).catch(() => {});
  }, [conversationId, withResolvedMediaUrl]);

  // Check WhatsApp connection status (DB-only) once per conversation open
  useEffect(() => {
    getWhatsAppConnectionStatus()
      .then((s) => { if (isMountedRef.current) setWaConnected(s.connected); })
      .catch(() => { if (isMountedRef.current) setWaConnected(false); });
  }, [conversationId, withResolvedMediaUrl]);

  // Smart auto-scroll: only if user is near the bottom (reading latest)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Force scroll to bottom when opening a conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [conversationId, loading]);

  // Realtime subscription (service_role bypasses RLS)
  useEffect(() => {
    const supabase = getRealtimeClient();
    const channel = supabase
      .channel(`admin-msgs-${conversationId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        if (!isMountedRef.current) return;
        const newMsg = payload.new as Message;
        withResolvedMediaUrl(newMsg).then((resolvedMsg) => {
          if (!isMountedRef.current) return;
          setMessages(prev => {
            if (prev.some(m => m.id === resolvedMsg.id)) return prev;
            return [...prev, resolvedMsg];
          });
        });
        markConversationAsRead(conversationId).catch(() => {});
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        if (!isMountedRef.current) return;
        const updated = payload.new as Message;
        withResolvedMediaUrl(updated).then((resolvedMsg) => {
          if (!isMountedRef.current) return;
          setMessages(prev => prev.map(m => m.id === resolvedMsg.id ? resolvedMsg : m));
        });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn("[realtime] chat-window subscribe status:", status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, withResolvedMediaUrl]);

  async function handleSend(content: string) {
    if (!content.trim()) return;
    setSending(true);
    try {
      const { data, error } = await sendMessageViaWhatsApp(conversationId, content);
      if (error && !data) {
        if (isContextError(error)) { handleContextExpired(); return; }
        toast.error(error);
      } else if (data) {
        setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data]);
        if (error) toast.error(`Falha ao enviar: ${error}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar mensagem");
    } finally {
      if (isMountedRef.current) setSending(false);
    }
  }

  async function handleSendMedia(file: { mediaUrl: string; type: "image" | "audio" | "video" | "document"; fileName: string; caption?: string }) {
    setSending(true);
    try {
      const { data, error } = await sendMediaViaWhatsApp(conversationId, file);
      if (error && !data) {
        if (isContextError(error)) { handleContextExpired(); return; }
        toast.error(error);
      } else if (data) {
        setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data]);
        if (error) toast.error(`Falha ao enviar: ${error}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar midia");
    } finally {
      if (isMountedRef.current) setSending(false);
    }
  }

  async function handleRetry(messageId: string) {
    if (retryingIds.has(messageId)) return;
    setRetryingIds(prev => new Set(prev).add(messageId));
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: "sending" } : m));
    try {
      const { data, error } = await resendMessage(messageId);
      // Sync local with canonical server state (realtime may reorder rapid UPDATEs)
      if (data) setMessages(prev => prev.map(m => m.id === messageId ? data : m));
      if (error) toast.error(`Falha ao reenviar: ${error}`);
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status: "failed" } : m));
      toast.error(e instanceof Error ? e.message : "Erro ao reenviar");
    } finally {
      if (isMountedRef.current) {
        setRetryingIds(prev => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    }
  }

  async function handleClose() {
    const { error } = await closeConversation(conversationId);
    if (error) toast.error(error);
    else {
      toast.success("Conversa fechada");
      onBack();
    }
  }

  async function handleTransferToAI() {
    const { error } = await assignConversation(conversationId, "ai");
    if (error) toast.error(error);
    else toast.success("Transferido para IA");
    setShowMenu(false);
  }

  if (loading) return <ChatWindowSkeleton />;

  const lead = conversation?.leads;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-3 border-b border-border bg-card shrink-0">
        <button onClick={onBack} aria-label="Voltar" className="md:hidden text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </button>

        <div className={`size-8 rounded-full flex items-center justify-center text-white text-xs font-medium ${hashColor(lead?.name ?? null)}`}>
          {getInitials(lead?.name ?? null)}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{lead?.name || lead?.phone || "Lead"}</p>
          <p className="text-[11px] text-muted-foreground">
            {lead?.phone && <span>{lead.phone}</span>}
            {conversation?.assigned_to === "ai" && <span className="ml-2 text-emerald-400">IA</span>}
          </p>
        </div>

        {/* Actions */}
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} aria-label="Mais opcoes" className="text-muted-foreground/60 hover:text-foreground p-1">
            <MoreHorizontal className="size-5" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
                <button onClick={handleTransferToAI} className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2">
                  <Bot className="size-4" /> Transferir p/ IA
                </button>
                <button onClick={handleClose} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-muted flex items-center gap-2">
                  <X className="size-4" /> Fechar conversa
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.map((msg, i) => {
          const isAgent = msg.sender !== "lead";
          const showDate = i === 0 || !isSameDay(messages[i - 1].created_at, msg.created_at);
          const failed = msg.status === "failed";
          const pending = msg.status === "sending";

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex justify-center my-3">
                  <span className="text-[10px] text-muted-foreground/60 bg-card px-3 py-1 rounded-full">
                    {formatDateSeparator(msg.created_at)}
                  </span>
                </div>
              )}
              <div className={`flex ${isAgent ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[70%] px-3 py-2 rounded-2xl text-sm ${
                    isAgent
                      ? msg.sender === "ai"
                        ? "bg-emerald-900/40 text-emerald-100 rounded-br-md"
                        : failed
                          ? "bg-red-900/30 text-red-100 rounded-br-md border border-red-500/40"
                          : "bg-primary/20 text-[#F8F5F0] rounded-br-md"
                      : "bg-card text-foreground rounded-bl-md"
                  } ${pending ? "opacity-70" : ""}`}
                >
                  {msg.sender === "ai" && (
                    <span className="text-[10px] text-emerald-400 block mb-0.5">IA</span>
                  )}
                  <MessageContent msg={msg} />
                  <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-muted-foreground/60">
                    <span>{formatMessageTime(msg.created_at)}</span>
                    {isAgent && <StatusIndicator status={msg.status} onRetry={failed ? () => handleRetry(msg.id) : undefined} isRetrying={retryingIds.has(msg.id)} />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* WhatsApp disconnected banner */}
      {waConnected === false && (
        <div className="px-4 py-2 bg-amber-900/30 border-t border-amber-500/40 text-xs text-amber-200 flex items-center gap-2 shrink-0">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">WhatsApp desconectado. Mensagens enviadas vao falhar.</span>
          <a href="/settings/whatsapp" className="underline hover:text-amber-100 shrink-0">Conectar</a>
        </div>
      )}

      {/* Input */}
      <MessageInput conversationId={conversationId} onSend={handleSend} onSendMedia={handleSendMedia} sending={sending} />
    </div>
  );
}

// ---- Media Message Renderer ----

function MessageContent({ msg }: { msg: Message }) {
  const type = msg.type || "text";
  const mediaUrl = msg.media_url;

  // Text message
  if (type === "text" || !mediaUrl) {
    return <p className="whitespace-pre-wrap break-words">{msg.content || "[Mensagem vazia]"}</p>;
  }

  // Image
  if (type === "image") {
    return (
      <div className="space-y-1">
        <img
          src={mediaUrl}
          alt="Imagem"
          className="max-w-[240px] rounded-lg cursor-pointer hover:opacity-90"
          onClick={() => window.open(mediaUrl, "_blank")}
        />
        {msg.content && <p className="whitespace-pre-wrap break-words text-xs">{msg.content}</p>}
      </div>
    );
  }

  // Audio
  if (type === "audio") {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Mic className="size-4 shrink-0" />
          {mediaUrl.startsWith("data:") || mediaUrl.startsWith("http") ? (
            <audio controls className="h-8 max-w-[200px]">
              <source src={mediaUrl} />
            </audio>
          ) : (
            <span className="text-xs">Audio</span>
          )}
        </div>
        {msg.content && <p className="whitespace-pre-wrap break-words text-xs">{msg.content}</p>}
      </div>
    );
  }

  // Video
  if (type === "video") {
    return (
      <div className="space-y-1">
        {mediaUrl.startsWith("data:") || mediaUrl.startsWith("http") ? (
          <video controls className="max-w-[240px] rounded-lg">
            <source src={mediaUrl} />
          </video>
        ) : (
          <div className="flex items-center gap-2 p-2 bg-black/20 rounded-lg">
            <Video className="size-5" />
            <span className="text-xs">Video</span>
          </div>
        )}
        {msg.content && <p className="whitespace-pre-wrap break-words text-xs">{msg.content}</p>}
      </div>
    );
  }

  // Document
  if (type === "document") {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 p-2 bg-black/20 rounded-lg">
          <FileText className="size-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium truncate block">{msg.content || "Documento"}</span>
          </div>
          {(mediaUrl.startsWith("http")) && (
            <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <Download className="size-4 hover:text-foreground" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // Fallback
  return <p className="whitespace-pre-wrap break-words">{msg.content || `[${type}]`}</p>;
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
    return <Loader2 className="size-3 animate-spin text-muted-foreground/60" aria-label="Enviando" />;
  }
  if (status === "failed") {
    return (
      <button
        onClick={onRetry}
        disabled={!onRetry}
        className="inline-flex items-center gap-0.5 text-red-300 hover:text-red-100 transition-colors disabled:cursor-not-allowed"
        title="Reenviar mensagem"
        aria-label="Reenviar mensagem falhada"
      >
        <AlertCircle className="size-3" />
        <RotateCw className="size-3" />
      </button>
    );
  }
  // sent / delivered / read
  return <Check className="size-3 text-muted-foreground/70" aria-label="Enviado" />;
}

// ---- Loading Skeleton ----

function ChatWindowSkeleton() {
  return (
    <div className="flex flex-col h-full bg-background" aria-hidden>
      <div className="h-14 px-4 flex items-center gap-3 border-b border-border bg-card shrink-0">
        <div className="size-8 rounded-full bg-muted animate-pulse" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-32 bg-muted rounded animate-pulse" />
          <div className="h-2 w-20 bg-muted rounded animate-pulse" />
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-4 py-4 space-y-3">
        {[
          { w: 200, right: false },
          { w: 160, right: true },
          { w: 240, right: false },
          { w: 180, right: true },
          { w: 140, right: false },
        ].map((b, i) => (
          <div key={i} className={`flex ${b.right ? "justify-end" : "justify-start"}`}>
            <div
              className={`h-10 rounded-2xl animate-pulse ${b.right ? "bg-primary/10" : "bg-card"}`}
              style={{ width: b.w }}
            />
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-border bg-card h-[66px]" />
    </div>
  );
}
