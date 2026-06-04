"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNotificationSound, useDesktopNotification } from "@/lib/hooks/use-notification";
import { getConversation } from "@/actions/conversations";
import { assignConversation, closeConversation, markConversationAsRead, generateConversationSummary, scheduleMessage } from "@/actions/conversations";
import { getMessages, resendMessage, resolveMessageMediaUrl, editWhatsAppMessage, reactToWhatsAppMessage, deleteWhatsAppMessage, hideMessage, pinWhatsAppMessage, type Message } from "@/actions/messages";
import { MessageInput } from "@/components/chat/message-input";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@persia/ui/alert-dialog";
// AlertDialog kept for conversation close confirm only
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
import { Sheet, SheetContent } from "@persia/ui/sheet";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Calendar,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  FileText,
  Info,
  Loader2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Pause,
  Pencil,
  Phone,
  Pin,
  Play,
  Reply,
  RotateCw,
  Search,
  Smile,
  Sparkles,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { LeadContactPanel, type LeadContactData } from "@/components/chat/lead-contact-panel";
import { TagPicker } from "@/components/tags/tag-picker";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const LEAD_COLORS = [
  { bg: "#ec4899", fg: "#ffffff" },
  { bg: "#84cc16", fg: "#ffffff" },
  { bg: "#06b6d4", fg: "#ffffff" },
  { bg: "#f97316", fg: "#ffffff" },
  { bg: "#8b5cf6", fg: "#ffffff" },
  { bg: "#10b981", fg: "#ffffff" },
  { bg: "#ef4444", fg: "#ffffff" },
  { bg: "#0ea5e9", fg: "#ffffff" },
];

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

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-label="WhatsApp">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
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

function leadColorForKey(key: string | null | undefined): { bg: string; fg: string } {
  const value = key || "unknown";
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return LEAD_COLORS[Math.abs(hash) % LEAD_COLORS.length];
}

function getLeadTags(lead: Record<string, unknown> | undefined) {
  const leadTags = lead?.lead_tags;
  if (!Array.isArray(leadTags)) return [];
  return leadTags
    .map((lt) => {
      if (!lt || typeof lt !== "object") return null;
      const tag = (lt as { tags?: unknown }).tags;
      if (!tag || typeof tag !== "object") return null;
      return tag as { id: string; name: string; color: string | null };
    })
    .filter((tag): tag is { id: string; name: string; color: string | null } =>
      Boolean(tag?.id && tag?.name),
    );
}

function tagPillStyle(color: string | null | undefined) {
  if (!color) return {};
  return {
    backgroundColor: `${color}1A`,
    borderColor: `${color}55`,
    color,
  };
}

function shouldResolveMediaUrl(mediaUrl: string | null): boolean {
  if (!mediaUrl) return false;
  return mediaUrl.startsWith("chat-media:") || mediaUrl.includes("/storage/v1/object/public/chat-media/");
}

// ---- Audio Player (WhatsApp-style) ----
const WAVEFORM = [3, 5, 8, 6, 10, 7, 12, 9, 14, 11, 16, 13, 15, 10, 12, 8, 6, 9, 11, 14, 12, 10, 7, 9, 11, 8, 6, 5, 8, 10, 7, 5];

function AudioPlayer({ src, isOutgoing }: { src: string; isOutgoing: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState(1);

  const RATES = [1, 1.5, 2];

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => {});
      setPlaying(true);
    }
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const rateLabel = rate.toFixed(1).replace(".", ",") + "x";

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] max-w-[240px] py-0.5">
      {/* Circular play/pause */}
      <button
        onClick={togglePlay}
        className="size-10 shrink-0 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
        style={{
          background: isOutgoing ? "rgba(0,0,0,0.18)" : "var(--chat-send-bg)",
          color: isOutgoing ? "inherit" : "var(--chat-send-fg)",
        }}
      >
        {playing
          ? <Pause className="size-4 fill-current" />
          : <Play className="size-4 fill-current ml-0.5" />}
      </button>

      {/* Waveform + duration + speed */}
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-px h-5">
          {WAVEFORM.map((h, i) => {
            const pct = (i / WAVEFORM.length) * 100;
            const filled = pct <= progress;
            return (
              <div
                key={i}
                className="flex-1 rounded-full"
                style={{
                  height: `${(h / 16) * 100}%`,
                  backgroundColor: filled
                    ? (isOutgoing ? "rgba(255,255,255,0.9)" : "var(--chat-send-bg)")
                    : "currentColor",
                  opacity: filled ? 1 : 0.35,
                }}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] tabular-nums opacity-70">
            {fmt(playing ? currentTime : duration)}
          </span>
          <button
            onClick={cycleRate}
            className="text-[10px] tabular-nums font-medium rounded-full px-1.5 py-0.5 transition-opacity hover:opacity-80"
            style={{
              background: isOutgoing ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.08)",
            }}
          >
            {rateLabel}
          </button>
        </div>
      </div>

      {/* Mic icon */}
      <Mic className="size-4 shrink-0 opacity-50" />

      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (a && a.duration) {
            setCurrentTime(a.currentTime);
            setProgress((a.currentTime / a.duration) * 100);
          }
        }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }}
      />
    </div>
  );
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
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [editDialogMsgId, setEditDialogMsgId] = useState<string | null>(null);
  const [editDialogText, setEditDialogText] = useState("");
  const [deleteDialogMsgId, setDeleteDialogMsgId] = useState<string | null>(null);
  const [contactPanelOpen, setContactPanelOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [messageSearch, setMessageSearch] = useState("");
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

  const handleReact = useCallback(async (msgId: string, emoji: string) => {
    setReactionPickerMsgId(null);
    // Optimistic update — metadata updated in DB by server action, Realtime confirms
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const meta = (m.metadata as Record<string, unknown>) ?? {};
        const existing = Array.isArray(meta.reactions)
          ? (meta.reactions as Array<{ emoji: string; by: string }>)
          : [];
        return {
          ...m,
          metadata: { ...meta, reactions: [...existing.filter((r) => r.by !== "agent"), { emoji, by: "agent" }] },
        };
      })
    );
    const result = await reactToWhatsAppMessage(msgId, emoji);
    if (result.error) toast.error(result.error);
  }, []);

  const startEdit = useCallback((msgId: string, currentText: string) => {
    setEditDialogMsgId(msgId);
    setEditDialogText(currentText);
  }, []);

  const handleEditSave = useCallback(async () => {
    const msgId = editDialogMsgId;
    if (!msgId) return;
    const trimmed = editDialogText.trim();
    if (!trimmed) return;
    setEditDialogMsgId(null);
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const meta = (m.metadata as Record<string, unknown>) ?? {};
        return { ...m, content: trimmed, metadata: { ...meta, edited_at: new Date().toISOString() } };
      })
    );
    const result = await editWhatsAppMessage(msgId, trimmed);
    if (result.error) toast.error(result.error);
  }, [editDialogMsgId, editDialogText]);

  const handleDeleteForEveryone = useCallback(async () => {
    const msgId = deleteDialogMsgId;
    if (!msgId) return;
    setDeleteDialogMsgId(null);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, status: "deleted", content: null } : m)));
    const result = await deleteWhatsAppMessage(msgId);
    if (result.error) toast.error(result.error);
  }, [deleteDialogMsgId]);

  const handleDeleteForMe = useCallback(async () => {
    const msgId = deleteDialogMsgId;
    if (!msgId) return;
    setDeleteDialogMsgId(null);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, status: "deleted", content: null } : m)));
    const result = await hideMessage(msgId);
    if (result.error) toast.error(result.error);
  }, [deleteDialogMsgId]);

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
    const result = await closeConversation(conversationId);
    setClosing(false);
    setCloseConfirmOpen(false);
    if (result?.error) {
      toast.error(`Não foi possível fechar a conversa: ${result.error}`);
    } else {
      toast.success("Conversa encerrada. IA será reativada no próximo contato do lead.");
    }
  };

  const handleMessageSent = (message: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
    shouldAutoScroll.current = true;
    if (conversationId && message.sender === "agent") {
      getConversation(conversationId)
        .then(({ data }) => {
          if (data) setConversation(data);
        })
        .catch(() => {});
    }
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

  const leadForPanel = lead
    ? (lead as unknown as LeadContactData)
    : null;
  const leadColor = leadColorForKey(
    (lead?.id as string | undefined) ??
    (lead?.phone as string | undefined) ??
    (lead?.name as string | undefined),
  );
  const leadTags = getLeadTags(lead);
  const normalizedMessageSearch = messageSearch.trim().toLowerCase();
  const visibleMessages = normalizedMessageSearch
    ? messages.filter((message) =>
        [
          message.content,
          message.type,
          message.sender,
          message.status,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedMessageSearch)),
      )
    : messages;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--chat-bg)" }}>
      {/* Header - WhatsApp style with action bar */}
      <div
        className="flex min-h-[59px] shrink-0 items-center justify-between border-b border-[color:var(--chat-sidebar-divider)] px-4 py-2"
        style={{
          background: "var(--chat-header-bg)",
          color: "var(--chat-header-fg)",
        }}
      >
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
          {/* Bug A fix (mai/2026): tenta carregar foto do WhatsApp
              (lead.avatar_url populado pelo pipeline via UAZAPI
              /chat/details). Cai pro AvatarFallback com iniciais se
              não houver foto, falhar ao carregar, ou provider Meta
              Cloud (que não expõe profile pic). */}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setContactPanelOpen(true)}
            className="h-auto rounded-full p-0"
            aria-label="Abrir dados do contato"
            title="Abrir dados do contato"
          >
            <Avatar size="default">
              {lead?.avatar_url ? (
                <AvatarImage
                  src={lead.avatar_url as string}
                  alt={lead?.name as string | undefined}
                />
              ) : null}
              <AvatarFallback style={{ backgroundColor: leadColor.bg, color: leadColor.fg }}>
                {getInitials(lead?.name as string | null)}
              </AvatarFallback>
            </Avatar>
          </Button>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setContactPanelOpen(true)}
                className="h-auto min-w-0 justify-start p-0 text-left font-semibold leading-5 hover:underline"
                style={{ color: leadColor.bg }}
                title="Abrir dados do contato"
              >
                {(lead?.name as string) || "Sem nome"}
              </Button>
              {(conversation?.channel as string) === "whatsapp" ? (
                <WhatsAppIcon className="size-4 text-success shrink-0" />
              ) : (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] capitalize">
                  {conversation?.channel as string}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
              <Phone className="size-3" />
              <span className="truncate">{(lead?.phone as string) || "Sem telefone"}</span>
            </div>
            {leadTags.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setTagManagerOpen(true)}
                className="h-auto max-w-[340px] flex items-center gap-1 overflow-hidden p-0 pt-0.5 hover:bg-transparent hover:opacity-80"
                title="Gerenciar tags"
              >
                {leadTags.slice(0, 3).map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="outline"
                    className="h-5 max-w-[96px] truncate rounded-md border px-1.5 text-[10px]"
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
              </Button>
            )}
          </div>
        </div>

        {/* Action buttons bar */}
        <div className="flex items-center gap-2">
          <div className="relative hidden w-[260px] lg:block xl:w-[360px]">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
              placeholder="Buscar na conversa..."
              className="h-9 rounded-lg bg-[color:var(--chat-input-field-bg)] pl-8 text-sm"
            />
          </div>
          {isAiHandling && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAssign}
              disabled={assigning}
              className="border-border text-foreground hover:bg-muted hover:text-foreground"
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
              className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Retomar IA"
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
              className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
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
              className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Transferir conversa"
              aria-label="Transferir conversa"
            >
              <UserPlus className="size-4" />
            </Button>
          )}

          {/* Contact panel toggle */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setContactPanelOpen((v) => !v)}
            className={`size-8 rounded-lg hover:bg-muted ${contactPanelOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            title="Detalhes do contato"
            aria-label="Detalhes do contato"
          >
            <Info className="size-4" />
          </Button>

          {/* More options dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon-sm" className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Mais opções">
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
                  onClick={() => setCloseConfirmOpen(true)}
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
      <div className="wa-chat-wallpaper flex-1 overflow-y-auto px-2 sm:px-3">
        <div className="flex flex-col py-4">
          {messages.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma mensagem ainda
            </div>
          )}
          {messages.length > 0 && visibleMessages.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma mensagem encontrada para esta busca
            </div>
          )}
          {visibleMessages.map((msg, idx) => {
            const isLead = msg.sender === "lead";
            const isAi = msg.sender === "ai";
            const isAgent = msg.sender === "agent";

            // Date separator
            const showDateSeparator =
              idx === 0 ||
              !isSameDay(visibleMessages[idx - 1].created_at, msg.created_at);

            // Grouping: smaller gap when same sender, larger when sender changes
            const prevSameSender =
              idx > 0 &&
              !showDateSeparator &&
              visibleMessages[idx - 1].sender === msg.sender;
            const spacingClass = idx === 0 || showDateSeparator
              ? ""
              : prevSameSender
                ? "mt-0.5"
                : "mt-2";

            return (
              <div key={msg.id} className={spacingClass}>
                {/* Date separator */}
                {showDateSeparator && (
                  <div className="flex items-center justify-center py-3">
                    <span className="rounded-lg bg-[color:var(--chat-header-bg)] px-3 py-1 text-[12px] font-medium text-muted-foreground shadow-sm">
                      {formatDateSeparator(msg.created_at)}
                    </span>
                  </div>
                )}

                {/* Message bubble - Lead LEFT, IA+Agent RIGHT */}
                {(() => {
                  const meta = msg.metadata as { reactions?: Array<{ emoji: string; by: string }>; edited_at?: string } | null;
                  const msgReactions = meta?.reactions?.filter((r) => r.emoji) ?? [];
                  const isEdited = !!meta?.edited_at;
                  const hasReactions = msgReactions.length > 0;
                  const canModify = !isLead && !!msg.whatsapp_msg_id && msg.status !== "deleted";

                  // Controls: 😊 + ⌄ — shown on group-hover
                  const msgControls = (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity self-end mb-1">
                      {/* Reaction picker trigger */}
                      <div className="relative">
                        <button
                          onClick={() => setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id)}
                          className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/10 transition-colors"
                          title="Reagir"
                        >
                          <Smile className="size-4" />
                        </button>
                        {reactionPickerMsgId === msg.id && (
                          <div
                            className={cn(
                              "absolute bottom-full mb-1 z-30",
                              "flex items-center rounded-full border border-border bg-background px-2 py-1.5 shadow-lg gap-0.5",
                              isLead ? "left-0" : "right-0"
                            )}
                          >
                            {QUICK_REACTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => handleReact(msg.id, emoji)}
                                className="text-[20px] leading-none hover:scale-125 transition-transform px-0.5"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Context menu */}
                      <DropdownMenu>
                        <DropdownMenuTrigger className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/10 transition-colors" title="Mais opções">
                          <ChevronDown className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align={isLead ? "start" : "end"} className="min-w-[160px]">
                          <DropdownMenuItem
                            onClick={() => setReplyTo(msg)}
                          >
                            <Reply className="size-4" />
                            Responder
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              if (msg.content) navigator.clipboard.writeText(msg.content);
                            }}
                          >
                            <Copy className="size-4" />
                            Copiar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id)}
                          >
                            <Smile className="size-4" />
                            Reagir
                          </DropdownMenuItem>
                          {canModify && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={async () => {
                                  const result = await pinWhatsAppMessage(msg.id);
                                  if (result.error) toast.error(result.error);
                                  else toast.success("Mensagem fixada");
                                }}
                              >
                                <Pin className="size-4" />
                                Fixar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => startEdit(msg.id, msg.content || "")}
                              >
                                <Pencil className="size-4" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeleteDialogMsgId(msg.id)}
                              >
                                <Trash2 className="size-4" />
                                Apagar
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );

                  // Avatar do lead no topo do bloco, como no WhatsApp.
                  const isFirstInBlock =
                    isLead &&
                    (idx === 0 ||
                      visibleMessages[idx - 1].sender !== msg.sender);

                  return (
                    <div
                      className={cn(
                        "group flex max-w-[85%] gap-1",
                        isLead ? "flex-row" : "ml-auto flex-row-reverse"
                      )}
                    >
                      {/* Avatar do lead — alinhado ao topo do bloco */}
                      {isLead && (
                        <div className="w-6 shrink-0 self-start mt-0.5">
                          {isFirstInBlock ? (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setContactPanelOpen(true)}
                              className="h-auto rounded-full p-0"
                              aria-label="Abrir dados do contato"
                              title="Abrir dados do contato"
                            >
                              <Avatar size="sm">
                                {(lead?.avatar_url as string | null) ? (
                                  <AvatarImage src={lead!.avatar_url as string} alt={lead?.name as string | undefined} />
                                ) : null}
                                <AvatarFallback className="text-[9px]" style={{ backgroundColor: leadColor.bg, color: leadColor.fg }}>
                                  {((lead?.name as string) || (lead?.phone as string) || "L").slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            </Button>
                          ) : null}
                        </div>
                      )}

                      {/* Hover controls */}
                      {msgControls}

                      {/* Bubble column */}
                      <div className={cn("flex flex-col gap-0.5", isLead ? "items-start" : "items-end")}>
                        {/* Sender label */}
                        {isAi && (
                          <div
                            className="flex items-center gap-1 text-[11px] px-1"
                            style={{ color: "var(--chat-checkmark-read)" }}
                          >
                            <Bot className="size-3" />
                            <span className="font-medium">IA</span>
                          </div>
                        )}
                        {isAgent && (
                          <div
                            className="flex items-center gap-1 text-[11px] px-1"
                            style={{ color: "var(--chat-timestamp)" }}
                          >
                            <UserCheck className="size-3" />
                            <span className="font-medium">Você</span>
                          </div>
                        )}
                        {isLead && isFirstInBlock && (
                          <div
                            className="flex items-center gap-1 text-[11px] px-1"
                          >
                            <User className="size-3" />
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setContactPanelOpen(true)}
                              className="h-auto p-0 font-semibold hover:underline"
                              style={{ color: leadColor.bg }}
                              title="Abrir dados do contato"
                            >
                              {(lead?.name as string) ||
                                (lead?.phone as string) ||
                                "Lead"}
                            </Button>
                          </div>
                        )}

                        {/* Bubble + reaction badge */}
                        <div
                          className="relative"
                          style={{ marginBottom: hasReactions ? "14px" : undefined }}
                        >
                          {msg.status === "deleted" ? (
                            <div
                              className={cn(
                                "flex items-center gap-1.5 rounded-[7.5px] px-3 py-1.5 text-[13px] leading-5 shadow-sm",
                                isLead ? "rounded-bl-sm" : "rounded-br-sm"
                              )}
                              style={
                                isLead
                                  ? { background: "var(--chat-bubble-in)", color: "var(--chat-timestamp)" }
                                  : { background: "var(--chat-bubble-out)", color: "var(--chat-timestamp)" }
                              }
                            >
                              <X className="size-3.5 shrink-0 opacity-60" />
                              <span className="italic opacity-80">Mensagem apagada</span>
                              <span className="text-[10px] ml-auto pl-2 shrink-0">
                                {formatMessageTime(msg.created_at)}
                              </span>
                            </div>
                          ) : (
                            <div
                              className={cn(
                                "relative rounded-[7.5px] px-2.5 py-1.5 text-[14.2px] leading-5 shadow-sm",
                                isAgent && msg.status === "failed"
                                  ? "rounded-br-sm bg-failure/90 text-failure-foreground border border-failure"
                                  : isAgent && "rounded-br-sm",
                                isAi && "rounded-br-sm",
                                isLead && "rounded-bl-sm",
                                isAgent && msg.status === "sending" && "opacity-70"
                              )}
                              style={
                                isAgent && msg.status === "failed"
                                  ? undefined
                                  : isLead
                                    ? { background: "var(--chat-bubble-in)", color: "var(--chat-bubble-in-text)" }
                                    : { background: "var(--chat-bubble-out)", color: "var(--chat-bubble-out-text)" }
                              }
                            >
                              {msg.media_url && msg.type === "image" && (
                                <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={msg.media_url} alt="" className="max-h-64 rounded-xl object-cover mb-1" />
                                </a>
                              )}
                              {msg.media_url && (msg.type === "audio" || msg.type === "ptt") && (
                                <div className="mb-1">
                                  <AudioPlayer src={msg.media_url} isOutgoing={!isLead} />
                                </div>
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
                                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                              )}
                              {/* Time + "Editada" + status - WhatsApp style */}
                              <span
                                className="text-[10px] float-right ml-2 mt-1 inline-flex items-center gap-1"
                                style={{ color: "var(--chat-timestamp)" }}
                              >
                                {isEdited && <span className="italic">Editada ·</span>}
                                {formatMessageTime(msg.created_at)}
                                {(isAgent || isAi) && (
                                  <StatusIndicator
                                    status={msg.status}
                                    onRetry={msg.status === "failed" ? () => handleRetry(msg.id) : undefined}
                                    isRetrying={retryingIds.has(msg.id)}
                                  />
                                )}
                              </span>
                            </div>
                          )}

                          {/* Reaction badge — overlaps bottom edge of bubble, WhatsApp-style */}
                          {hasReactions && (
                            <div
                              className={cn(
                                "absolute -bottom-3.5 flex gap-0.5",
                                isLead ? "left-2" : "right-2"
                              )}
                            >
                              {msgReactions.map((r, i) => (
                                <span
                                  key={i}
                                  className="rounded-full border border-border bg-background px-1.5 py-0.5 text-sm leading-none shadow-sm"
                                >
                                  {r.emoji}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
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
          replyTo={replyTo ? {
            id: replyTo.id,
            whatsapp_msg_id: replyTo.whatsapp_msg_id ?? null,
            content: replyTo.content ?? null,
            sender: replyTo.sender === "lead" ? ((conversation as any)?.leads?.name || "Lead") : "Você",
          } : null}
          onClearReply={() => setReplyTo(null)}
        />
      </div>

      {/* Contact panel — Sheet overlay, não empurra o layout */}
      <Sheet open={contactPanelOpen && !!leadForPanel} onOpenChange={(o) => { if (!o) setContactPanelOpen(false); }}>
        <SheetContent side="right" showCloseButton={false} className="w-full max-w-[440px] p-0 overflow-hidden">
          {leadForPanel && (
            <LeadContactPanel
              lead={leadForPanel}
              onClose={() => setContactPanelOpen(false)}
            />
          )}
        </SheetContent>
      </Sheet>

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

      {/* Tag manager dialog */}
      {leadId && (
        <Dialog open={tagManagerOpen} onOpenChange={setTagManagerOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Gerenciar tags do lead</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <TagPicker
                leadId={leadId}
                initialTags={leadTags.map((t) => ({ ...t, color: t.color ?? "" }))}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit message modal — WhatsApp style */}
      <Dialog open={!!editDialogMsgId} onOpenChange={(open) => { if (!open) setEditDialogMsgId(null); }}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>Editar mensagem</DialogTitle>
          </DialogHeader>
          {/* Preview bubble */}
          <div className="wa-chat-wallpaper px-4 py-3">
            <div className="ml-auto max-w-[80%] rounded-[7.5px] rounded-br-sm px-2.5 py-1.5 text-[14.2px] leading-5 shadow-sm"
              style={{ background: "var(--chat-bubble-out)", color: "var(--chat-bubble-out-text)" }}
            >
              <p className="whitespace-pre-wrap break-words opacity-50 text-sm">{editDialogText || "..."}</p>
            </div>
          </div>
          {/* Edit input */}
          <div className="flex items-end gap-2 px-4 pb-4 pt-2">
            <textarea
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={editDialogText}
              onChange={(e) => setEditDialogText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleEditSave(); }
                if (e.key === "Escape") setEditDialogMsgId(null);
              }}
              placeholder="Editar mensagem..."
              className="flex-1 min-h-[44px] max-h-[120px] resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              rows={Math.max(1, (editDialogText.match(/\n/g) || []).length + 1)}
            />
            <button
              onClick={() => void handleEditSave()}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              title="Salvar edição"
            >
              <Check className="size-4" />
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete message confirmation — WhatsApp style with 3 options */}
      <Dialog open={!!deleteDialogMsgId} onOpenChange={(open) => { if (!open) setDeleteDialogMsgId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Deseja apagar a mensagem?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => void handleDeleteForEveryone()}
            >
              <Trash2 className="size-4 mr-2" />
              Apagar para todos
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => void handleDeleteForMe()}
            >
              Apagar para mim
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setDeleteDialogMsgId(null)}
            >
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de confirmacao pra fechar conversa (kebab > "Fechar conversa"). */}
      {/* Reativa IA automaticamente — a proxima msg do lead cria conversation nova. */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              A conversa será marcada como encerrada. A IA será reativada
              automaticamente quando o lead enviar uma nova mensagem (em
              uma conversa nova). O histórico desta conversa fica preservado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClose}
              disabled={closing}
            >
              {closing ? "Encerrando..." : "Encerrar conversa"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Status Indicator (WhatsApp-style ticks) ----

// Bug B fix (mai/2026): renderiza checkmarks ao estilo WhatsApp:
//   sending  → loader spin
//   sent     → 1 check cinza
//   delivered → 2 checks cinza (sobrepostos, ✓✓)
//   read      → 2 checks azuis (✓✓ azul)
//   failed    → ícone alerta + retry
//
// Status `delivered` e `read` só ficam disponíveis depois do PR de
// Bug B (webhook UAZAPI inscrito em "messages_update"). Antes, todas
// as msgs travavam em "sent" pra sempre.
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
  if (status === "read") {
    return (
      <span
        aria-label="Lido pelo destinatário"
        title="Lido"
      >
        <CheckCheck
          className="size-3.5"
          style={{ color: "var(--chat-checkmark-read)" }}
        />
      </span>
    );
  }
  if (status === "delivered") {
    return (
      <span
        aria-label="Entregue ao destinatário"
        title="Entregue"
      >
        <CheckCheck
          className="size-3.5"
          style={{ color: "var(--chat-checkmark-default)" }}
        />
      </span>
    );
  }
  // Default = "sent" (1 check)
  return (
    <Check
      className="size-3"
      style={{ color: "var(--chat-checkmark-default)" }}
      aria-label="Enviado"
    />
  );
}
