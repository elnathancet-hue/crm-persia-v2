"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { getConversation, getConversations, uploadScheduledMessageMediaAction, type ConversationWithLead } from "@/actions/conversations";
import { assignConversation, closeConversation, markConversationAsRead, generateConversationSummary, scheduleMessage, transferConversationToQueue } from "@/actions/conversations";
import { createAppointment } from "@/actions/agenda/appointments";
import { getMessages, resendMessage, resolveMessageMediaUrl, editWhatsAppMessage, reactToWhatsAppMessage, deleteWhatsAppMessage, hideMessage, pinWhatsAppMessage, forwardMessagesToConversations, type Message } from "@/actions/messages";
import { MessageInput } from "@/components/chat/message-input";
import { MediaViewer } from "@/components/chat/media-viewer";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Checkbox } from "@persia/ui/checkbox";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@persia/ui/select";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Calendar,
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Forward,
  Info,
  Loader2,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Pause,
  Pencil,
  Phone,
  Pin,
  MapPin,
  Contact,
  CreditCard,
  LocateFixed,
  Play,
  Reply,
  RotateCw,
  Search,
  Send,
  Smile,
  Sparkles,
  Trash2,
  Upload,
  User,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";

function getMessageFileName(message: Message): string {
  const metadata = message.metadata && typeof message.metadata === "object"
    ? message.metadata as Record<string, unknown>
    : null;
  return typeof metadata?.file_name === "string" && metadata.file_name
    ? metadata.file_name
    : message.content || "Documento";
}

type ReplyPreview = {
  id?: string;
  whatsapp_msg_id?: string | null;
  sender?: string | null;
  content?: string | null;
  type?: string | null;
  media_type?: string | null;
};

function getMessageMetadata(message: Message): Record<string, unknown> | null {
  return message.metadata && typeof message.metadata === "object"
    ? message.metadata as Record<string, unknown>
    : null;
}

function getReplyPreview(message: Message, messagesById: Map<string, Message>): ReplyPreview | null {
  const metadata = getMessageMetadata(message);
  const embedded = metadata?.reply_to;
  if (embedded && typeof embedded === "object") return embedded as ReplyPreview;

  const replyToId = metadata?.reply_to_message_id;
  if (typeof replyToId === "string") {
    const resolved = messagesById.get(replyToId);
    if (resolved) {
      return {
        id: resolved.id,
        whatsapp_msg_id: resolved.whatsapp_msg_id,
        sender: resolved.sender,
        content: resolved.content,
        type: resolved.type,
        media_type: resolved.media_type,
      };
    }
  }

  return null;
}

function getReplySenderLabel(reply: ReplyPreview, leadName?: string | null): string {
  if (reply.sender === "lead") return leadName || "Lead";
  if (reply.sender === "ai") return "IA";
  return "Voce";
}

function getReplyContentPreview(reply: ReplyPreview): string {
  if (reply.content?.trim()) return reply.content.trim();
  const mediaKind = reply.media_type || reply.type;
  if (mediaKind === "image") return "Imagem";
  if (mediaKind === "audio" || mediaKind === "ptt") return "Audio";
  if (mediaKind === "video") return "Video";
  if (mediaKind === "document") return "Documento";
  if (mediaKind === "sticker") return "Figurinha";
  return "Mensagem";
}

function normalizeMessagesPage(data: Message[] | null | undefined): {
  messages: Message[];
  hasMore: boolean;
} {
  const rows = data ?? [];
  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  return {
    messages: hasMore ? rows.slice(1) : rows,
    hasMore,
  };
}
import { LeadContactPanel, type LeadContactData } from "@/components/chat/lead-contact-panel";
import { TagPicker } from "@/components/tags/tag-picker";
import { LeadInfoDrawer, LeadsProvider } from "@persia/leads-ui";
import { crmLeadsActions } from "@/features/leads/crm-leads-actions";
import { getLead } from "@/actions/leads";
import type { LeadWithTags } from "@persia/shared/crm";

const QUICK_REACTIONS = ["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MESSAGE_PAGE_SIZE = 50;

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

// Converte markdown do WhatsApp em React nodes.
// Suporta: *negrito*, _itálico_, ~tachado~, `monoespaço`.
// Preserva quebras de linha via whitespace-pre-wrap no container.
function formatWhatsAppText(text: string): React.ReactNode {
  const regex = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const raw = match[0];
    const inner = raw.slice(1, -1);
    const k = String(key++);
    if (raw[0] === "*") parts.push(<strong key={k}>{inner}</strong>);
    else if (raw[0] === "_") parts.push(<em key={k}>{inner}</em>);
    else if (raw[0] === "~") parts.push(<s key={k}>{inner}</s>);
    else parts.push(<code key={k} className="font-mono text-[0.9em] bg-black/10 rounded px-0.5">{inner}</code>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? <>{parts}</> : text;
}

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
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [media, setMedia] = useState<{
    media_type: "none" | "image" | "video" | "audio" | "document";
    media_url: string;
    media_filename: string;
    media_mime_type: string;
    media_size: number;
  } | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  const handleSchedule = async () => {
    if (!messageText.trim() && !media) {
      toast.error("Digite uma mensagem ou anexe uma imagem");
      return;
    }
    if (!scheduleDate) {
      toast.error("Escolha a data de envio");
      return;
    }
    setSaving(true);
    try {
      await scheduleMessage(
        conversationId,
        messageText.trim(),
        new Date(scheduleDate).toISOString(),
        media?.media_type && media.media_type !== "none" ? media.media_type : "text",
        media,
      );
      toast.success("Mensagem agendada!");
      setMessageText("");
      setScheduleDate("");
      setMedia(null);
      setMediaUploadError(null);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao agendar");
    } finally {
      setSaving(false);
    }
  };

  const handleMediaFile = async (file: File | null) => {
    setMediaUploadError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMediaUploadError("Por enquanto, o agendamento aceita imagens.");
      return;
    }

    const formData = new FormData();
    formData.set("file", file);
    setMediaUploading(true);
    try {
      const result = await uploadScheduledMessageMediaAction(formData);
      if (result.error || !result.data) {
        setMediaUploadError(result.error ?? "Erro ao enviar imagem");
        return;
      }
      if (result.data.media_type !== "image") {
        setMediaUploadError("Selecione um arquivo de imagem.");
        return;
      }
      setMedia({
        media_type: result.data.media_type,
        media_url: result.data.media_url,
        media_filename: result.data.media_filename,
        media_mime_type: result.data.media_mime_type,
        media_size: result.data.media_size,
      });
    } finally {
      setMediaUploading(false);
    }
  };

  const clearMedia = () => {
    setMedia(null);
    setMediaUploadError(null);
    if (mediaInputRef.current) mediaInputRef.current.value = "";
  };

  const setQuickSchedule = (minutes: number) => {
    const date = new Date(Date.now() + minutes * 60_000);
    setScheduleDate(date.toISOString().slice(0, 16));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Calendar className="size-5" />
          </div>
          <DialogTitle>Agendar mensagem</DialogTitle>
          <DialogDescription>
            Programe uma mensagem para ser enviada automaticamente nesta conversa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Label htmlFor="scheduled-message-content">Mensagem</Label>
              <span className="text-xs text-muted-foreground">{messageText.length}/1000</span>
            </div>
            <Textarea
              id="scheduled-message-content"
              name="scheduled_message_content"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value.slice(0, 1000))}
              placeholder="Digite sua mensagem..."
              className="min-h-[128px] resize-none"
              maxLength={1000}
            />
          </div>

          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Imagem</Label>
                <p className="text-xs text-muted-foreground">Envie uma imagem com legenda opcional.</p>
              </div>
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleMediaFile(event.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={mediaUploading}
                onClick={() => mediaInputRef.current?.click()}
              >
                {mediaUploading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Upload className="mr-1.5 size-3.5" />}
                {mediaUploading ? "Enviando..." : "Adicionar"}
              </Button>
            </div>
            {mediaUploadError && (
              <p className="mt-2 text-xs font-medium text-destructive">{mediaUploadError}</p>
            )}
            {media && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{media.media_filename}</p>
                  <p className="text-xs text-muted-foreground">{Math.ceil(media.media_size / 1024)} KB</p>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" onClick={clearMedia} aria-label="Remover imagem">
                  <X className="size-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-muted/20 p-3">
            <Label htmlFor="scheduled-message-date">Data e hora de envio</Label>
            <Input
              id="scheduled-message-date"
              name="scheduled_message_date"
              type="datetime-local"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="mt-2"
            />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setQuickSchedule(60)}>
                +1h
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setQuickSchedule(24 * 60)}>
                Amanhã
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setQuickSchedule(48 * 60)}>
                +2 dias
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancelar
          </DialogClose>
          <Button onClick={handleSchedule} disabled={saving}>
            {saving ? "Agendando..." : "Agendar mensagem"}
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

    // Fetch active queues (is_active added in migration 104)
    supabase
      .from("queues")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("name")
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
                        await transferConversationToQueue(conversationId, queue.id);
                        toast.success(`Transferido para fila ${queue.name}`);
                        onOpenChange(false);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Erro ao transferir");
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
  const [apptDialogOpen, setApptDialogOpen] = useState(false);
  const [apptTitle, setApptTitle] = useState("");
  const [apptDate, setApptDate] = useState("");
  const [apptTime, setApptTime] = useState("");
  const [apptDuration, setApptDuration] = useState("60");
  const [apptChannel, setApptChannel] = useState<"whatsapp" | "phone" | "online" | "in_person" | "">("");
  const [apptDescription, setApptDescription] = useState("");
  const [savingAppt, setSavingAppt] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [editDialogMsgId, setEditDialogMsgId] = useState<string | null>(null);
  const [editDialogText, setEditDialogText] = useState("");
  const [deleteDialogMsgId, setDeleteDialogMsgId] = useState<string | null>(null);
  const [contactPanelOpen, setContactPanelOpen] = useState(false);
  const [leadDrawerOpen, setLeadDrawerOpen] = useState(false);
  const [drawerLead, setDrawerLead] = useState<LeadWithTags | null>(null);
  const [supabaseClient] = useState(() => createClient());
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [messageSearch, setMessageSearch] = useState("");
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [forwardMode, setForwardMode] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [forwardMessageIds, setForwardMessageIds] = useState<Set<string>>(new Set());
  const [forwardTargetIds, setForwardTargetIds] = useState<Set<string>>(new Set());
  const [forwardConversations, setForwardConversations] = useState<ConversationWithLead[]>([]);
  const [forwardSearch, setForwardSearch] = useState("");
  const [mediaViewer, setMediaViewer] = useState<{ type: "image" | "video"; url: string } | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handlePinMessage = useCallback(async (msgId: string, pin: boolean) => {
    const result = await pinWhatsAppMessage(msgId, pin);
    if (result.error) { toast.error(result.error); return; }
    toast.success(pin ? "Mensagem fixada" : "Mensagem desafixada");
    setMessages((prev) => prev.map((m) => ({
      ...m,
      is_pinned: pin ? m.id === msgId : (m.id === msgId ? false : m.is_pinned),
    })));
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

  const startForward = useCallback((messageId: string) => {
    setForwardMode(true);
    setForwardMessageIds(new Set([messageId]));
    setForwardTargetIds(new Set());
    setForwardSearch("");
  }, []);

  const cancelForward = useCallback(() => {
    setForwardMode(false);
    setForwardMessageIds(new Set());
    setForwardTargetIds(new Set());
    setForwardSearch("");
  }, []);

  const toggleForwardMessage = useCallback((messageId: string) => {
    setForwardMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        if (next.size >= 10) {
          toast.warning("Máximo de 10 mensagens por encaminhamento");
          return prev;
        }
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const toggleForwardTarget = useCallback((targetId: string) => {
    setForwardTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(targetId)) {
        next.delete(targetId);
      } else {
        if (next.size >= 20) {
          toast.warning("Máximo de 20 destinos por encaminhamento");
          return prev;
        }
        next.add(targetId);
      }
      return next;
    });
  }, []);

  const handleForwardMessages = useCallback(async () => {
    if (forwardMessageIds.size === 0) {
      toast.error("Selecione pelo menos uma mensagem");
      return;
    }
    if (forwardTargetIds.size === 0) {
      toast.error("Selecione pelo menos uma conversa");
      return;
    }

    setForwarding(true);
    try {
      const result = await forwardMessagesToConversations([...forwardMessageIds], [...forwardTargetIds]);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Mensagens encaminhadas: ${result.sent_count}`);
      if (result.skipped_count > 0) {
        toast.warning(`${result.skipped_count} item(ns) nao foram encaminhados`);
      }
      cancelForward();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel encaminhar");
    } finally {
      setForwarding(false);
    }
  }, [cancelForward, forwardMessageIds, forwardTargetIds]);

  useEffect(() => {
    if (!forwardMode) return;

    let cancelled = false;
    getConversations(orgId, { search: forwardSearch })
      .then((result) => {
        if (!cancelled) setForwardConversations(result.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setForwardConversations([]);
      });

    return () => {
      cancelled = true;
    };
  }, [forwardMode, forwardSearch, orgId]);

  const handleOpenLeadDrawer = useCallback(async () => {
    const id = ((conversation as Record<string, unknown>)?.leads as Record<string, unknown> | undefined)?.id as string | undefined;
    if (!id) return;
    try {
      const result = await getLead(id);
      if (result?.lead) {
        setDrawerLead(result.lead as LeadWithTags);
        setLeadDrawerOpen(true);
      }
    } catch {
      // silent
    }
  }, [conversation]);

  // Load conversation + messages when selected conversation changes
  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      setMessages([]);
      setHasMoreMessages(false);
      return;
    }

    shouldAutoScroll.current = true;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [convResult, msgResult] = await Promise.all([
        getConversation(conversationId!),
        getMessages(conversationId!, { limit: MESSAGE_PAGE_SIZE + 1 }),
      ]);

      if (cancelled) return;

      if (convResult.data) setConversation(convResult.data);
      if (msgResult.data) {
        const page = normalizeMessagesPage(msgResult.data);
        setMessages(page.messages);
        setHasMoreMessages(page.hasMore);
      }
      setLoading(false);

      // Mark as read when opening
      markConversationAsRead(conversationId!).catch(() => {});

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = messagesScrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (!conversationId || loadingOlderMessages || messages.length === 0) return;

    const scrollEl = messagesScrollRef.current;
    const previousScrollHeight = scrollEl?.scrollHeight ?? 0;
    const before = messages[0]?.created_at;
    if (!before) return;

    setLoadingOlderMessages(true);
    try {
      const result = await getMessages(conversationId, {
        limit: MESSAGE_PAGE_SIZE + 1,
        before,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      const page = normalizeMessagesPage(result.data);
      setHasMoreMessages(page.hasMore);
      if (page.messages.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((message) => message.id));
          const older = page.messages.filter((message) => !existingIds.has(message.id));
          return [...older, ...prev];
        });
        shouldAutoScroll.current = false;
        window.requestAnimationFrame(() => {
          if (!scrollEl) return;
          scrollEl.scrollTop += scrollEl.scrollHeight - previousScrollHeight;
        });
      }
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [conversationId, loadingOlderMessages, messages]);

  // Supabase Realtime: INSERT (new messages) + UPDATE (status transitions)
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();
    let realtimeOk = true;

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
          const scrollEl = messagesScrollRef.current;
          shouldAutoScroll.current =
            !scrollEl ||
            scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 150;
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
        if (status === "SUBSCRIBED") {
          realtimeOk = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          console.warn("[realtime] chat-window subscribe status:", status);
          realtimeOk = false;
        }
      });

    // Polling fallback: merge novas msgs quando realtime está morto
    const pollInterval = setInterval(() => {
      if (realtimeOk) return;
      getMessages(conversationId, { limit: 10 }).then((result) => {
        if (result.error || !result.data?.length) return;
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const fresh = result.data!.filter((m) => !ids.has(m.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      });
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [conversationId, withResolvedMediaUrl]);

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

  const handleSaveAppointment = async () => {
    if (!apptTitle.trim() || !apptDate || !apptTime) return;
    setSavingAppt(true);
    try {
      const start = new Date(`${apptDate}T${apptTime}`);
      const durationMin = parseInt(apptDuration, 10);
      const end = new Date(start.getTime() + durationMin * 60_000);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await createAppointment({
        kind: "appointment",
        title: apptTitle.trim(),
        description: apptDescription.trim() || null,
        lead_id: leadId ?? null,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        duration_minutes: durationMin,
        timezone: tz,
        status: "confirmed",
        channel: apptChannel || null,
        location: null,
        meeting_url: null,
        service_id: null,
        booking_page_id: null,
      });
      toast.success("Agendamento criado na agenda!");
      setApptDialogOpen(false);
      setApptTitle("");
      setApptDate("");
      setApptTime("");
      setApptDuration("60");
      setApptChannel("");
      setApptDescription("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar agendamento");
    } finally {
      setSavingAppt(false);
    }
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

  const handleReplaceMessage = (tempId: string, msg: Message | null) => {
    setMessages((prev) => {
      if (msg === null) return prev.filter((m) => m.id !== tempId);
      // If realtime already added the real message, just remove the optimistic placeholder
      if (prev.some((m) => m.id === msg.id)) {
        return prev.filter((m) => m.id !== tempId);
      }
      return prev.map((m) => (m.id === tempId ? msg : m));
    });
  };

  // Memoizados antes dos early returns para satisfazer Rules of Hooks
  const pinnedMessage = useMemo(() => messages.find((m) => m.is_pinned) ?? null, [messages]);
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

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
  const leadDisplayName = (lead?.name as string | undefined) || (lead?.phone as string | undefined) || null;

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
                <DropdownMenuItem onClick={handleOpenLeadDrawer}>
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
              <DropdownMenuItem
                onClick={() => {
                  const leadName = lead?.name as string | undefined;
                  setApptTitle(leadName ? `Consulta com ${leadName}` : "Consulta");
                  const now = new Date(Date.now() + 60 * 60_000);
                  setApptDate(now.toISOString().slice(0, 10));
                  setApptTime(now.toTimeString().slice(0, 5));
                  setApptDialogOpen(true);
                }}
              >
                <CalendarPlus className="size-4" />
                Agendar consulta
              </DropdownMenuItem>
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

      {/* Pinned message banner */}
      {pinnedMessage && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--chat-sidebar-divider)] px-3 py-1.5" style={{ background: "var(--chat-header-bg)" }}>
          <div className="w-0.5 self-stretch rounded-full bg-primary shrink-0" />
          <Pin className="size-3.5 shrink-0 text-primary" />
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              const el = document.querySelector(`[data-msg-id="${pinnedMessage.id}"]`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            <p className="text-[11px] font-semibold text-primary">Mensagem fixada</p>
            <p className="truncate text-xs text-muted-foreground">{pinnedMessage.content || "Mídia"}</p>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0"
            aria-label="Desafixar"
            onClick={() => handlePinMessage(pinnedMessage.id, false)}
          >
            <X className="size-3" />
          </Button>
        </div>
      )}

      {/* Messages - WhatsApp style with subtle pattern background */}
      <div ref={messagesScrollRef} className="wa-chat-wallpaper flex-1 overflow-y-auto px-2 sm:px-3">
        <div className="flex flex-col py-4">
          {messages.length > 0 && hasMoreMessages && !normalizedMessageSearch && (
            <div className="flex justify-center pb-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleLoadOlderMessages}
                disabled={loadingOlderMessages}
                className="h-8 rounded-full px-3 text-xs shadow-sm"
              >
                {loadingOlderMessages ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Carregando...
                  </>
                ) : (
                  <>
                    <RotateCw className="size-3.5" />
                    Carregar mensagens anteriores
                  </>
                )}
              </Button>
            </div>
          )}
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
              <div key={msg.id} data-msg-id={msg.id} className={spacingClass}>
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
                  const replyPreview = getReplyPreview(msg, messagesById);
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
                          {msg.media_url && (
                            <DropdownMenuItem
                              onClick={() => {
                                const a = document.createElement("a");
                                a.href = msg.media_url!;
                                a.download = "";
                                a.target = "_blank";
                                a.click();
                              }}
                            >
                              <Download className="size-4" />
                              Baixar
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id)}
                          >
                            <Smile className="size-4" />
                            Reagir
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => startForward(msg.id)}
                            disabled={!msg.content?.trim()}
                          >
                            <Forward className="size-4" />
                            Encaminhar
                          </DropdownMenuItem>
                          {canModify && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handlePinMessage(msg.id, !msg.is_pinned)}
                              >
                                <Pin className="size-4" />
                                {msg.is_pinned ? "Desafixar" : "Fixar"}
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
                      {forwardMode && (
                        <div className="flex w-6 shrink-0 items-start justify-center pt-6">
                          <Checkbox
                            checked={forwardMessageIds.has(msg.id)}
                            onCheckedChange={() => toggleForwardMessage(msg.id)}
                            disabled={!msg.content?.trim()}
                            aria-label="Selecionar mensagem para encaminhar"
                          />
                        </div>
                      )}
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
                              {replyPreview && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!replyPreview.id) return;
                                    const el = document.querySelector(`[data-msg-id="${replyPreview.id}"]`);
                                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }}
                                  className="mb-1.5 block w-full max-w-[260px] rounded-md border-l-4 px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/10"
                                  style={{
                                    borderColor: "var(--chat-send-bg)",
                                    background: "rgba(0,0,0,0.06)",
                                  }}
                                >
                                  <span className="block truncate font-semibold text-[color:var(--chat-send-bg)]">
                                    {getReplySenderLabel(replyPreview, leadDisplayName)}
                                  </span>
                                  <span className="line-clamp-2 text-muted-foreground">
                                    {getReplyContentPreview(replyPreview)}
                                  </span>
                                </button>
                              )}
                              {msg.media_url && msg.type === "sticker" && (
                                <button
                                  type="button"
                                  onClick={() => setMediaViewer({ type: "image", url: msg.media_url! })}
                                  className="block focus:outline-none"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={msg.media_url}
                                    alt="Sticker"
                                    className="size-28 object-contain"
                                  />
                                </button>
                              )}
                              {msg.type === "image" && (
                                msg._optimistic ? (
                                  <div className="relative mb-1 max-w-[240px]">
                                    {msg._localPreview ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={msg._localPreview} alt="" className="max-h-64 rounded-xl object-cover opacity-50" />
                                    ) : (
                                      <div className="w-[240px] h-[160px] rounded-xl bg-black/10" />
                                    )}
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <Loader2 className="size-8 text-white drop-shadow animate-spin" />
                                    </div>
                                  </div>
                                ) : msg.media_url ? (
                                  <button
                                    type="button"
                                    onClick={() => setMediaViewer({ type: "image", url: msg.media_url! })}
                                    className="block max-w-[240px] cursor-zoom-in overflow-hidden rounded-xl mb-1 focus:outline-none"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={msg.media_url} alt="" className="max-h-64 w-full object-cover" />
                                  </button>
                                ) : null
                              )}
                              {(msg.type === "audio" || msg.type === "ptt") && (
                                msg._optimistic ? (
                                  <div className="mb-1 flex items-center gap-2 px-2">
                                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">Enviando áudio...</span>
                                  </div>
                                ) : msg.media_url ? (
                                  <div className="mb-1">
                                    <AudioPlayer src={msg.media_url} isOutgoing={!isLead} />
                                  </div>
                                ) : null
                              )}
                              {msg.type === "video" && (
                                msg._optimistic ? (
                                  <div className="relative mb-1 max-w-[240px]">
                                    <div className="w-[240px] h-[160px] rounded-xl bg-black/10 flex items-center justify-center">
                                      <Loader2 className="size-8 text-white drop-shadow animate-spin" />
                                    </div>
                                  </div>
                                ) : msg.media_url ? (
                                  <button
                                    type="button"
                                    onClick={() => setMediaViewer({ type: "video", url: msg.media_url! })}
                                    className="relative block max-w-[240px] cursor-pointer overflow-hidden rounded-xl mb-1 focus:outline-none"
                                  >
                                    <video className="max-h-64 w-full rounded-xl pointer-events-none">
                                      <source src={msg.media_url} />
                                    </video>
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors">
                                      <div className="flex size-12 items-center justify-center rounded-full bg-black/60">
                                        <Play className="size-6 text-white ml-1" fill="white" />
                                      </div>
                                    </div>
                                  </button>
                                ) : null
                              )}
                              {msg.type === "document" && (
                                msg._optimistic ? (
                                  <div className="mb-1 flex min-w-56 items-center gap-3 rounded-md border border-border/60 bg-background/60 p-3">
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                      <Loader2 className="size-5 animate-spin" />
                                    </span>
                                    <span className="text-xs text-muted-foreground">Enviando documento...</span>
                                  </div>
                                ) : msg.media_url ? (
                                  <a
                                    href={msg.media_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mb-1 flex min-w-56 items-center gap-3 rounded-md border border-border/60 bg-background/60 p-3 text-foreground hover:bg-background/80"
                                  >
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                      <FileText className="size-5" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block max-w-52 truncate text-xs font-medium">
                                        {getMessageFileName(msg)}
                                      </span>
                                      <span className="block text-[10px] text-muted-foreground">
                                        Abrir documento
                                      </span>
                                    </span>
                                  </a>
                                ) : null
                              )}
                              {msg.type === "location" && Boolean(msg.metadata) && (
                                <div className="flex flex-col gap-1 mb-1">
                                  <a
                                    href={`https://maps.google.com/?q=${(msg.metadata as any).latitude},${(msg.metadata as any).longitude}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-[13px] font-medium text-destructive hover:underline"
                                  >
                                    <MapPin className="size-4" />
                                    {(msg.metadata as any).name || "Localização"}
                                  </a>
                                  {(msg.metadata as any).address && <p className="text-[11px] opacity-80">{(msg.metadata as any).address as string}</p>}
                                </div>
                              )}
                              {msg.type === "contact" && Boolean(msg.metadata) && (
                                <div className="flex items-center gap-2 mb-1 p-2 bg-black/5 rounded-md">
                                  <Contact className="size-6 text-primary" />
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-sm">{(msg.metadata as any).fullName || "Contato"}</span>
                                    <span className="text-xs opacity-80">{(msg.metadata as any).phoneNumber as string}</span>
                                  </div>
                                </div>
                              )}
                              {msg.type === "pix" && Boolean(msg.metadata) && (
                                <div className="flex items-center gap-2 mb-1 p-2 border border-success/30 bg-success/10 rounded-md text-success">
                                  <CreditCard className="size-5 shrink-0" />
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-semibold text-sm">Chave PIX ({(msg.metadata as any).pixType || "EVP"})</span>
                                    <span className="text-xs font-mono truncate">{(msg.metadata as any).pixKey as string}</span>
                                  </div>
                                </div>
                              )}
                              {msg.type === "payment" && Boolean(msg.metadata) && (
                                <div className="flex items-center gap-2 mb-1 p-2 border border-success/30 bg-success/10 rounded-md text-success">
                                  <CreditCard className="size-5 shrink-0" />
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-semibold text-sm">Cobrança R$ {Number((msg.metadata as any).amount).toFixed(2)}</span>
                                    <span className="text-xs font-mono truncate">PIX: {(msg.metadata as any).pixKey as string}</span>
                                  </div>
                                </div>
                              )}
                              {msg.type === "location_button" && Boolean(msg.metadata) && (
                                <div className="flex items-center justify-center gap-2 mb-1 p-2 bg-progress/10 border border-progress/30 text-progress rounded-md">
                                  <LocateFixed className="size-4" />
                                  <span className="font-medium text-sm">{(msg.metadata as any).text || "Enviar Localização"}</span>
                                </div>
                              )}
                              {msg.content && (
                                <p className="whitespace-pre-wrap break-words">{formatWhatsAppText(msg.content)}</p>
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

      {forwardMode && (
        <div className="fixed left-1/2 top-1/2 z-40 w-[min(460px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-4 shadow-xl animate-in fade-in-0 zoom-in-95">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Encaminhar mensagens</p>
              <p className="text-[11px] text-muted-foreground">
                {forwardMessageIds.size}/10 mensagem{forwardMessageIds.size === 1 ? "" : "s"} · {forwardTargetIds.size}/20 conversa{forwardTargetIds.size === 1 ? "" : "s"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              onClick={cancelForward}
              aria-label="Cancelar encaminhamento"
            >
              <X className="size-3.5" />
            </Button>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <Label htmlFor="forward-conversation-search" className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Destinos
              </Label>
              <div className="relative mt-2">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="forward-conversation-search"
                  name="forward_conversation_search"
                  value={forwardSearch}
                  onChange={(event) => setForwardSearch(event.target.value)}
                  placeholder="Buscar conversa..."
                  className="pl-8"
                />
              </div>
              <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                {forwardConversations.filter((item) => item.id !== conversationId).slice(0, 25).map((item) => {
                  const lead = item.leads;
                  const title = lead?.name || lead?.phone || "Sem nome";
                  const selected = forwardTargetIds.has(item.id);

                  return (
                    // div em vez de Button para evitar <button> aninhado dentro de <button>
                    // (Radix Checkbox renderiza como <button>; nested buttons = HTML invalido)
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleForwardTarget(item.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleForwardTarget(item.id); } }}
                      className="flex h-auto w-full cursor-pointer items-center justify-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <Checkbox
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={() => toggleForwardTarget(item.id)}
                        aria-label={`Selecionar ${title}`}
                      />
                      <Avatar size="sm">
                        {lead?.avatar_url ? <AvatarImage src={lead.avatar_url} alt={title} /> : null}
                        <AvatarFallback className="text-[10px]">{getInitials(title)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.last_message?.content
                            ? item.last_message.content.replace(/[*_~`]/g, "")
                            : lead?.phone || "Conversa"}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <Button type="button" variant="outline" size="sm" onClick={cancelForward} disabled={forwarding}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleForwardMessages}
                disabled={forwarding || forwardMessageIds.size === 0 || forwardTargetIds.size === 0}
              >
                {forwarding ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Send className="mr-1.5 size-3.5" />}
                Encaminhar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input - shrink-0 so it stays at bottom */}
      <div className="shrink-0">
        <MessageInput
          conversationId={conversationId}
          onMessageSent={handleMessageSent}
          onReplaceMessage={handleReplaceMessage}
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
              conversationId={conversationId}
              onOpenLeadDrawer={() => void handleOpenLeadDrawer()}
              onClose={() => setContactPanelOpen(false)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Lead info drawer — opens inline without leaving chat */}
      {drawerLead && (
        <LeadsProvider actions={crmLeadsActions}>
          <LeadInfoDrawer
            open={leadDrawerOpen}
            onOpenChange={(o) => {
              if (!o) { setLeadDrawerOpen(false); setDrawerLead(null); }
            }}
            lead={drawerLead}
            supabase={supabaseClient}
            canEdit
          />
        </LeadsProvider>
      )}

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

      {/* Appointment dialog */}
      <Dialog open={apptDialogOpen} onOpenChange={(o) => { setApptDialogOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="space-y-2">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarPlus className="size-5" />
            </div>
            <DialogTitle>Agendar consulta</DialogTitle>
            <DialogDescription>
              O agendamento será criado na agenda e vinculado a este lead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input
                value={apptTitle}
                onChange={(e) => setApptTitle(e.target.value)}
                placeholder="Ex: Consulta com João"
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={apptDate}
                  onChange={(e) => setApptDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Hora</Label>
                <Input
                  type="time"
                  value={apptTime}
                  onChange={(e) => setApptTime(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duração</Label>
                <Select value={apptDuration} onValueChange={(v) => { if (v) setApptDuration(v); }}>
                  <SelectTrigger>
                    <SelectValue>{apptDuration ? `${apptDuration} min` : "Selecione"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 min</SelectItem>
                    <SelectItem value="30">30 min</SelectItem>
                    <SelectItem value="45">45 min</SelectItem>
                    <SelectItem value="60">60 min</SelectItem>
                    <SelectItem value="90">90 min</SelectItem>
                    <SelectItem value="120">120 min</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Canal</Label>
                <Select value={apptChannel} onValueChange={(v) => setApptChannel(v as typeof apptChannel)}>
                  <SelectTrigger>
                    <SelectValue>{apptChannel === "whatsapp" ? "WhatsApp" : apptChannel === "phone" ? "Telefone" : apptChannel === "online" ? "Online" : apptChannel === "in_person" ? "Presencial" : "Opcional"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Nenhum</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="phone">Telefone</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="in_person">Presencial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observações <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Textarea
                value={apptDescription}
                onChange={(e) => setApptDescription(e.target.value)}
                placeholder="Notas sobre a consulta..."
                className="min-h-[72px] resize-none"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              onClick={handleSaveAppointment}
              disabled={!apptTitle.trim() || !apptDate || !apptTime || savingAppt}
            >
              {savingAppt ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <CalendarPlus className="size-3.5 mr-1" />}
              Criar agendamento
            </Button>
          </DialogFooter>
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

      {/* Lightbox de mídia — estilo WhatsApp */}
      {mediaViewer && (
        <MediaViewer
          type={mediaViewer.type}
          url={mediaViewer.url}
          onClose={() => setMediaViewer(null)}
        />
      )}
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
