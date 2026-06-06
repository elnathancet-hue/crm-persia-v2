"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  ExternalLink,
  EyeOff,
  File,
  FileText,
  FileVideo,
  Image,
  ImageIcon,
  Link2,
  Loader2,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Reply,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Square,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { EmptyState } from "@persia/ui/empty-state";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Textarea } from "@persia/ui/textarea";
import { Switch } from "@persia/ui/switch";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@persia/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@persia/ui/popover";
import {
  updateGroup,
  getInviteLink,
  resetInviteLink,
  sendInviteToLead,
  sendMessageToGroup,
  sendMediaToGroup,
  deleteGroupMessage,
  editGroupMessage,
  pinGroupMessage,
  reactToGroupMessage,
  createLeadFromGroupParticipant,
} from "@/actions/groups";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useNotificationSound } from "@/lib/hooks/use-notification";
import { toast } from "sonner";

const QUICK_REACTIONS = ["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}", "\u{1F525}", "\u{1F4AA}"];

const CATEGORY_LABELS: Record<string, string> = {
  geral: "Geral",
  aquecimento: "Aquecimento",
  evento: "Evento",
  oferta: "Oferta",
  alunos: "Alunos",
};

const CHAT_TIME_ZONE = "America/Sao_Paulo";

function dateKeyInChatTimeZone(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHAT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function safeAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.includes("pps.whatsapp.net") ? null : url;
}

function initialsFromName(name: string | null | undefined): string {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: CHAT_TIME_ZONE,
  });
}

function formatDateLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const messageKey = dateKeyInChatTimeZone(d);
  if (messageKey === dateKeyInChatTimeZone(now)) return "Hoje";
  if (messageKey === dateKeyInChatTimeZone(addDays(now, -1))) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: CHAT_TIME_ZONE });
}

function isSameDay(a: string, b: string) {
  return dateKeyInChatTimeZone(new Date(a)) === dateKeyInChatTimeZone(new Date(b));
}

interface Group {
  id: string;
  group_jid: string;
  name: string;
  description: string | null;
  invite_link: string | null;
  participant_count: number;
  is_announce: boolean;
  is_locked: boolean;
  category: string;
  image_url: string | null;
}

interface Lead {
  id: string;
  name: string;
  phone: string | null;
}

interface GroupMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  sender_name: string | null;
  sender_jid: string | null;
  sender_phone: string | null;
  sender_lead_id: string | null;
  sender_membership_id: string | null;
  sender_identity_kind: "phone" | "lid" | "unknown" | null;
  sender_avatar_url: string | null;
  media_type: string | null;
  media_url: string | null;
  whatsapp_msg_id: string | null;
  reply_to_whatsapp_msg_id: string | null;
  is_pinned?: boolean;
  created_at: string;
}

async function resolveGroupMessageMediaUrl(
  supabase: ReturnType<typeof createClient>,
  row: GroupMessage,
): Promise<GroupMessage> {
  if (!row.media_url?.startsWith("chat-media:")) return row;
  const path = row.media_url.slice("chat-media:".length).replace(/^\/+/, "");
  const { data } = await (supabase as any).storage
    .from("chat-media")
    .createSignedUrl(path, 3600);
  return data?.signedUrl ? { ...row, media_url: data.signedUrl as string } : row;
}

// Lazy-load picker only when popover opens
const EmojiPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => <div className="p-4 text-xs text-muted-foreground">Carregando emojis...</div>,
});

// ---- Audio Player (WhatsApp-style) ----
const WAVEFORM = [3, 5, 8, 6, 10, 7, 12, 9, 14, 11, 16, 13, 15, 10, 12, 8, 6, 9, 11, 14, 12, 10, 7, 9, 11, 8, 6, 5, 8, 10, 7, 5];

function GroupAudioPlayer({ src, isOutgoing }: { src: string; isOutgoing: boolean }) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [rate, setRate] = React.useState(1);
  const RATES = [1, 1.5, 2];

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().catch(() => {}); setPlaying(true); }
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
      <button
        onClick={togglePlay}
        className="size-10 shrink-0 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
        style={{
          background: isOutgoing ? "rgba(0,0,0,0.18)" : "var(--chat-send-bg)",
          color: isOutgoing ? "inherit" : "var(--chat-send-fg)",
        }}
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current ml-0.5" />}
      </button>
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
          <span className="text-[10px] tabular-nums opacity-70">{fmt(playing ? currentTime : duration)}</span>
          <button
            onClick={cycleRate}
            className="text-[10px] tabular-nums font-medium rounded-full px-1.5 py-0.5 transition-opacity hover:opacity-80"
            style={{ background: isOutgoing ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.08)" }}
          >
            {rateLabel}
          </button>
        </div>
      </div>
      <Mic className="size-4 shrink-0 opacity-50" />
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (a && a.duration) { setCurrentTime(a.currentTime); setProgress((a.currentTime / a.duration) * 100); }
        }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }}
      />
    </div>
  );
}

export function GroupDetailClient({
  group,
  leads,
  initialMessages,
}: {
  group: Group;
  leads: Lead[];
  initialMessages: GroupMessage[];
}) {
  const router = useRouter();

  // Settings state
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [editName, setEditName] = React.useState(group.name);
  const [editDescription, setEditDescription] = React.useState(group.description || "");
  const [editCategory, setEditCategory] = React.useState(group.category);
  const [editAnnounce, setEditAnnounce] = React.useState(group.is_announce);
  const [editLocked, setEditLocked] = React.useState(group.is_locked);
  const [saving, setSaving] = React.useState(false);

  // Invite state
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState(group.invite_link || "");
  const [resettingLink, setResettingLink] = React.useState(false);
  const [selectedLeadId, setSelectedLeadId] = React.useState("");
  const [sendingInvite, setSendingInvite] = React.useState(false);

  // Chat state
  const [messages, setMessages] = React.useState<GroupMessage[]>(initialMessages);
  const [chatInput, setChatInput] = React.useState("");
  const [sendingMessage, setSendingMessage] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<GroupMessage | null>(null);
  const [creatingLeadFor, setCreatingLeadFor] = React.useState<string | null>(null);
  const [attachedFile, setAttachedFile] = React.useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = React.useState<string | null>(null);
  const [attachedMediaType, setAttachedMediaType] = React.useState<
    "image" | "video" | "audio" | "document"
  >("document");
  const [sendingMedia, setSendingMedia] = React.useState(false);
  const [reactingMsgId, setReactingMsgId] = React.useState<string | null>(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const [editingMsgId, setEditingMsgId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);

  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const audioFileInputRef = React.useRef<HTMLInputElement>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const recordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const { play: playNotification } = useNotificationSound();

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`group_detail_messages:${group.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${group.id}` },
        (payload) => {
          const row = payload.new as GroupMessage;
          resolveGroupMessageMediaUrl(supabase, row).then((resolved) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === resolved.id)) return prev;
              return [...prev, resolved];
            });
            if (resolved.direction === "inbound") playNotification();
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "group_messages", filter: `group_id=eq.${group.id}` },
        (payload) => {
          const row = payload.new as GroupMessage;
          resolveGroupMessageMediaUrl(supabase, row).then((resolved) => {
            setMessages((prev) => prev.map((m) => (m.id === resolved.id ? { ...m, ...resolved } : m)));
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "group_messages", filter: `group_id=eq.${group.id}` },
        (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [group.id, playNotification]);

  async function handleSaveSettings() {
    setSaving(true);
    try {
      await updateGroup(group.id, {
        name: editName.trim(),
        description: editDescription.trim(),
        is_announce: editAnnounce,
        locked: editLocked,
        category: editCategory,
      });
      toast.success("Configurações salvas");
      setSettingsOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleGetInviteLink() {
    try {
      const link = await getInviteLink(group.id);
      setInviteLink(link);
      toast.success("Link obtido");
    } catch (err: any) {
      toast.error(err.message || "Erro ao obter link");
    }
  }

  async function handleResetInviteLink() {
    setResettingLink(true);
    try {
      const link = await resetInviteLink(group.id);
      setInviteLink(link);
      toast.success("Link renovado");
    } catch (err: any) {
      toast.error(err.message || "Erro ao renovar link");
    } finally {
      setResettingLink(false);
    }
  }

  async function handleSendInvite() {
    if (!selectedLeadId) return;
    setSendingInvite(true);
    try {
      await sendInviteToLead(group.id, selectedLeadId);
      toast.success("Convite enviado!");
      setInviteOpen(false);
      setSelectedLeadId("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar convite");
    } finally {
      setSendingInvite(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    let mt: "image" | "video" | "audio" | "document" = "document";
    if (file.type.startsWith("image/")) mt = "image";
    else if (file.type.startsWith("video/")) mt = "video";
    else if (file.type.startsWith("audio/")) mt = "audio";
    setAttachedMediaType(mt);
    setAttachedFile(file);
    if (mt === "image") {
      const reader = new FileReader();
      reader.onload = (ev) => setAttachedPreview((ev.target?.result as string) ?? null);
      reader.readAsDataURL(file);
    } else {
      setAttachedPreview(null);
    }
  }

  function clearAttachment() {
    setAttachedFile(null);
    setAttachedPreview(null);
  }

  function formatRecordingTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  async function handleStartRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingSeconds(0);
        setSendingMedia(true);
        try {
          const formData = new FormData();
          formData.append("groupId", group.id);
          formData.append("file", blob, "audio.webm");
          formData.append("mediaType", "ptt");
          const result = await sendMediaToGroup(formData);
          if (result.error) throw new Error(result.error);
          if (result.message) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === result.message.id)) {
                return prev.map((m) => m.id === result.message.id ? { ...m, ...result.message } : m);
              }
              return [...prev, result.message as GroupMessage];
            });
          }
          toast.success("Áudio enviado");
        } catch (err: any) {
          toast.error(err.message || "Erro ao enviar áudio");
        } finally {
          setSendingMedia(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone");
    }
  }

  function handleStopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  function handleCancelRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingSeconds(0);
      };
      mediaRecorderRef.current.stop();
    }
  }

  async function handleSendMessage() {
    if (attachedFile) {
      const caption = chatInput.trim() || undefined;
      const file = attachedFile;
      const mt = attachedMediaType;
      clearAttachment();
      setChatInput("");
      setSendingMedia(true);
      try {
        const formData = new FormData();
        formData.append("groupId", group.id);
        formData.append("file", file);
        formData.append("mediaType", mt);
        if (caption) formData.append("caption", caption);
        const result = await sendMediaToGroup(formData);
        if (result.error) throw new Error(result.error);
        if (result.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === result.message.id)) {
              return prev.map((m) => m.id === result.message.id ? { ...m, ...result.message } : m);
            }
            return [...prev, result.message as GroupMessage];
          });
        }
        toast.success("Mídia enviada");
      } catch (err: any) {
        toast.error(err.message || "Erro ao enviar mídia");
      } finally {
        setSendingMedia(false);
      }
      return;
    }

    const text = chatInput.trim();
    if (!text) return;
    setSendingMessage(true);
    const currentReply = replyTo;
    setChatInput("");
    setReplyTo(null);
    try {
      await sendMessageToGroup(group.id, text, currentReply?.whatsapp_msg_id ?? null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
      setChatInput(text);
      setReplyTo(currentReply);
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleReact(msg: GroupMessage, emoji: string) {
    setReactingMsgId(null);
    if (!msg.whatsapp_msg_id) return;
    try {
      await reactToGroupMessage(group.id, msg.whatsapp_msg_id, emoji);
    } catch (err: any) {
      toast.error(err.message || "Erro ao reagir");
    }
  }

  async function handleDeleteMessage(msg: GroupMessage) {
    if (!msg.whatsapp_msg_id) return;
    try {
      await deleteGroupMessage(group.id, msg.id, msg.whatsapp_msg_id);
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    } catch (err: any) {
      toast.error(err.message || "Erro ao apagar mensagem");
    }
  }

  async function handleCreateLead(msg: GroupMessage) {
    if (!msg.sender_phone || msg.sender_lead_id) return;
    setCreatingLeadFor(msg.id);
    try {
      const { leadId } = await createLeadFromGroupParticipant({
        groupId: group.id,
        membershipId: msg.sender_membership_id,
        phone: msg.sender_phone,
        name: msg.sender_name || undefined,
      });
      setMessages((prev) =>
        prev.map((m) => (m.sender_phone === msg.sender_phone ? { ...m, sender_lead_id: leadId } : m)),
      );
      toast.success("Lead criado!", {
        action: { label: "Ver perfil", onClick: () => router.push(`/leads/${leadId}`) },
      });
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar lead");
    } finally {
      setCreatingLeadFor(null);
    }
  }

  async function handlePinMessage(msg: GroupMessage, pin: boolean) {
    if (!msg.whatsapp_msg_id) return;
    try {
      await pinGroupMessage(group.id, msg.id, msg.whatsapp_msg_id, pin);
      setMessages((prev) => prev.map((m) => ({
        ...m,
        is_pinned: pin ? m.id === msg.id : (m.id === msg.id ? false : m.is_pinned),
      })));
      toast.success(pin ? "Mensagem fixada" : "Mensagem desafixada");
    } catch (err: any) {
      toast.error(err.message || "Erro ao fixar mensagem");
    }
  }

  function handleStartEdit(msg: GroupMessage) {
    setEditingMsgId(msg.id);
    setEditText(msg.text ?? "");
  }

  async function handleConfirmEdit(msg: GroupMessage) {
    const text = editText.trim();
    if (!text || !msg.whatsapp_msg_id) { setEditingMsgId(null); return; }
    try {
      await editGroupMessage(group.id, msg.id, msg.whatsapp_msg_id, text);
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, text } : m));
      toast.success("Mensagem editada");
    } catch (err: any) {
      toast.error(err.message || "Erro ao editar");
    } finally {
      setEditingMsgId(null);
    }
  }

  function handleHideMessage(msgId: string) {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }

  function handleReply(msg: GroupMessage) {
    setReplyTo(msg);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") { setReplyTo(null); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — WhatsApp style */}
      <div
        className="flex h-[59px] shrink-0 items-center gap-3 border-b border-[color:var(--chat-sidebar-divider)] px-4"
        style={{ background: "var(--chat-header-bg)", color: "var(--chat-header-fg)" }}
      >
        <Link href="/groups">
          <Button variant="ghost" size="icon-sm">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>

        <div className="size-9 overflow-hidden rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          {safeAvatarUrl(group.image_url) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={safeAvatarUrl(group.image_url)!} alt="" className="size-full object-cover" />
          ) : (
            <Users className="size-5 text-primary" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-[15px] leading-5 truncate">{group.name}</p>
          <p className="text-[13px] leading-5 text-muted-foreground truncate">
            {group.participant_count} membros {"\u00B7"} {CATEGORY_LABELS[group.category] || group.category}
            {group.is_announce && ` \u00B7 Anúncio`}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon-sm" onClick={() => { setSearchOpen((o) => !o); setSearchQuery(""); }} title="Buscar mensagens">
            <Search className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setInviteOpen(true)} title="Convidar lead">
            <Link2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} title="Configurações">
            <Settings className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  if (inviteLink) {
                    navigator.clipboard.writeText(inviteLink);
                    toast.success("Link copiado!");
                  } else {
                    toast.error("Sem link de convite. Obtenha nas configurações.");
                  }
                }}
              >
                <Copy className="size-4" />
                Copiar link de convite
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div
          className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[color:var(--chat-sidebar-divider)]"
          style={{ background: "var(--chat-header-bg)" }}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar mensagens..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            style={{ color: "var(--chat-header-fg)" }}
            onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); } }}
          />
          {searchQuery && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              {messages.filter((m) => m.text?.toLowerCase().includes(searchQuery.toLowerCase())).length} resultado(s)
            </span>
          )}
          <Button variant="ghost" size="icon-sm" className="size-6 shrink-0" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}>
            <X className="size-3" />
          </Button>
        </div>
      )}

      {/* Pinned message banner */}
      {(() => {
        const pinned = messages.find((m) => m.is_pinned);
        if (!pinned) return null;
        return (
          <div
            className="flex shrink-0 items-center gap-2 border-b border-[color:var(--chat-sidebar-divider)] px-3 py-1.5"
            style={{ background: "var(--chat-header-bg)" }}
          >
            <div className="w-0.5 self-stretch rounded-full bg-primary shrink-0" />
            <Pin className="size-3.5 shrink-0 text-primary" />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                const el = document.querySelector(`[data-msg-id="${pinned.id}"]`);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              <p className="text-[11px] font-semibold text-primary">Mensagem fixada</p>
              <p className="truncate text-xs text-muted-foreground">{pinned.text || "Mídia"}</p>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6 shrink-0"
              aria-label="Desafixar"
              onClick={() => handlePinMessage(pinned, false)}
            >
              <X className="size-3" />
            </Button>
          </div>
        );
      })()}

      {/* Messages — WhatsApp wallpaper */}
      <div className="wa-chat-wallpaper flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-1 py-4">
          {(() => {
            const q = searchQuery.trim().toLowerCase();
            const displayed = q ? messages.filter((m) => m.text?.toLowerCase().includes(q)) : messages;
            if (displayed.length === 0) return (
              <div className="flex items-center justify-center py-16">
                <EmptyState
                  variant="subtle"
                  icon={<MessageSquare />}
                  title={q ? "Nenhum resultado" : "Nenhuma mensagem ainda"}
                  description={q ? `Sem mensagens contendo "${searchQuery}"` : "Envie a primeira mensagem para o grupo"}
                />
              </div>
            );
            return displayed.map((msg, idx) => {
              const isOutbound = msg.direction === "outbound";
              const showDateSep = idx === 0 || !isSameDay(displayed[idx - 1].created_at, msg.created_at);
              const prevMsg = idx > 0 ? displayed[idx - 1] : null;
              const prevSameSender =
                !showDateSep &&
                prevMsg &&
                prevMsg.direction === msg.direction &&
                (prevMsg.sender_jid ?? prevMsg.sender_name) ===
                  (msg.sender_jid ?? msg.sender_name);
              const isCreatingLead = creatingLeadFor === msg.id;

              const senderDisplayName =
                msg.sender_name ??
                msg.sender_phone ??
                (msg.sender_identity_kind === "lid" ? "Participante sem telefone" : "Participante");
              const senderSecondary =
                msg.sender_phone ??
                (msg.sender_identity_kind === "lid" ? "Telefone não disponível" : null);

              return (
                <div key={msg.id} data-msg-id={msg.id} className={prevSameSender ? "mt-0.5" : showDateSep ? "" : "mt-2"}>
                  {showDateSep && (
                    <div className="flex items-center justify-center py-3">
                      <span className="rounded-lg bg-[color:var(--chat-header-bg)] px-3 py-1 text-[12px] font-medium text-muted-foreground shadow-sm">
                        {formatDateLabel(msg.created_at)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`group/msg flex max-w-[86%] items-end gap-1 sm:max-w-[72%] ${
                      isOutbound ? "ml-auto flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {/* Avatar (inbound only) */}
                    {!isOutbound && (
                      <button
                        type="button"
                        disabled={!msg.sender_lead_id}
                        onClick={() =>
                          msg.sender_lead_id && router.push(`/leads/${msg.sender_lead_id}`)
                        }
                        className={`mb-1 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/40 bg-primary/10 text-[11px] font-semibold text-primary ${
                          msg.sender_lead_id
                            ? "cursor-pointer hover:ring-2 hover:ring-primary/25"
                            : "cursor-default"
                        }`}
                        title={
                          msg.sender_lead_id
                            ? "Abrir perfil do lead"
                            : (senderSecondary ?? senderDisplayName)
                        }
                      >
                        {safeAvatarUrl(msg.sender_avatar_url) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={safeAvatarUrl(msg.sender_avatar_url)!} alt="" className="size-full object-cover" />
                        ) : (
                          initialsFromName(senderDisplayName)
                        )}
                      </button>
                    )}

                    {/* Reaction + context menu — visible on hover */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity self-end mb-1 shrink-0">
                      {msg.whatsapp_msg_id && (
                        <div className="relative">
                          <button
                            type="button"
                            className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/10 transition-colors"
                            title="Reagir"
                            onClick={() => setReactingMsgId(reactingMsgId === msg.id ? null : msg.id)}
                          >
                            <Smile className="size-4" />
                          </button>
                          {reactingMsgId === msg.id && (
                            <div
                              className={cn(
                                "absolute bottom-full mb-1 z-30",
                                "flex items-center rounded-full border border-border bg-background px-2 py-1.5 shadow-lg gap-0.5",
                                isOutbound ? "right-0" : "left-0",
                              )}
                            >
                              {QUICK_REACTIONS.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => handleReact(msg, emoji)}
                                  className="text-[20px] leading-none hover:scale-125 transition-transform px-0.5"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/10 transition-colors"
                          title="Mais opções"
                        >
                          <ChevronDown className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align={isOutbound ? "end" : "start"}
                          className="min-w-[150px]"
                        >
                          <DropdownMenuItem onClick={() => handleReply(msg)}>
                            <Reply className="size-4" />
                            Responder
                          </DropdownMenuItem>
                          {msg.text && (
                            <DropdownMenuItem
                              onClick={() => {
                                navigator.clipboard.writeText(msg.text!);
                                toast.success("Copiado!");
                              }}
                            >
                              <Copy className="size-4" />
                              Copiar
                            </DropdownMenuItem>
                          )}
                          {isOutbound && msg.text && msg.whatsapp_msg_id && (
                            <DropdownMenuItem onClick={() => handleStartEdit(msg)}>
                              <Pencil className="size-4" />
                              Editar
                            </DropdownMenuItem>
                          )}
                          {msg.whatsapp_msg_id && (
                            <DropdownMenuItem onClick={() => handlePinMessage(msg, !msg.is_pinned)}>
                              <Pin className="size-4" />
                              {msg.is_pinned ? "Desafixar" : "Fixar"}
                            </DropdownMenuItem>
                          )}
                          {!isOutbound && (msg.sender_lead_id || msg.sender_phone) && (
                            <DropdownMenuSeparator />
                          )}
                          {!isOutbound && msg.sender_lead_id && (
                            <>
                              <DropdownMenuItem
                                onClick={() => router.push(`/leads/${msg.sender_lead_id!}`)}
                              >
                                <ExternalLink className="size-4" />
                                Ver perfil
                              </DropdownMenuItem>
                              {msg.sender_phone && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    router.push(`/chat?lead=${msg.sender_lead_id!}`)
                                  }
                                >
                                  <MessageCircle className="size-4" />
                                  Abrir chat 1:1
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                          {!isOutbound && !msg.sender_lead_id && msg.sender_phone && (
                            <DropdownMenuItem
                              onClick={() => handleCreateLead(msg)}
                              disabled={isCreatingLead}
                            >
                              {isCreatingLead ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <UserPlus className="size-4" />
                              )}
                              Criar lead
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleHideMessage(msg.id)}>
                            <EyeOff className="size-4" />
                            Apagar para mim
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDeleteMessage(msg)}
                          >
                            <Trash2 className="size-4" />
                            Apagar para todos
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Bubble column */}
                    <div
                      className={`flex flex-col gap-0.5 ${isOutbound ? "items-end" : "items-start"}`}
                    >
                      {/* Sender label above bubble (first of block only) */}
                      {!prevSameSender && (
                        isOutbound ? (
                          <p
                            className="text-[11px] px-1"
                            style={{ color: "var(--chat-timestamp)" }}
                          >
                            Você
                          </p>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={!msg.sender_lead_id}
                              onClick={() =>
                                msg.sender_lead_id &&
                                router.push(`/leads/${msg.sender_lead_id}`)
                              }
                              className={`flex max-w-[260px] items-center gap-1 px-1 text-left text-[11px] font-medium text-primary ${
                                msg.sender_lead_id ? "hover:underline" : "cursor-default"
                              }`}
                              title={senderSecondary ?? undefined}
                            >
                              <span className="truncate">{senderDisplayName}</span>
                              {msg.sender_lead_id && (
                                <Badge
                                  variant="secondary"
                                  className="h-4 px-1 text-[9px] leading-none"
                                >
                                  Lead
                                </Badge>
                              )}
                            </button>
                            {senderSecondary && senderSecondary !== senderDisplayName && (
                              <p className="max-w-[260px] truncate px-1 text-[10px] text-muted-foreground">
                                {senderSecondary}
                              </p>
                            )}
                          </>
                        )
                      )}

                      {/* Bubble */}
                      <div
                        className={`rounded-[7.5px] shadow-sm overflow-hidden ${
                          isOutbound ? "rounded-br-sm" : "rounded-bl-sm"
                        }`}
                        style={
                          isOutbound
                            ? {
                                background: "var(--chat-bubble-out)",
                                color: "var(--chat-bubble-out-text)",
                              }
                            : {
                                background: "var(--chat-bubble-in)",
                                color: "var(--chat-bubble-in-text)",
                              }
                        }
                      >
                        {/* Media content */}
                        {msg.media_type === "image" && msg.media_url && (
                          <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={msg.media_url}
                              alt="Imagem"
                              className="max-w-[240px] max-h-[200px] object-cover"
                            />
                          </a>
                        )}
                        {msg.media_type === "image" && !msg.media_url && (
                          <div className="flex items-center gap-2 px-2.5 pt-2">
                            <Image className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Imagem</span>
                          </div>
                        )}
                        {msg.media_type === "video" && msg.media_url && (
                          <video
                            controls
                            src={msg.media_url}
                            className="max-w-[240px] max-h-[200px] rounded-xl mb-1"
                          />
                        )}
                        {msg.media_type === "video" && !msg.media_url && (
                          <div className="flex items-center gap-2 px-2.5 pt-2">
                            <FileVideo className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Vídeo</span>
                          </div>
                        )}
                        {(msg.media_type === "audio" || msg.media_type === "ptt") && msg.media_url && (
                          <div className="px-2.5 pt-2 mb-1">
                            <GroupAudioPlayer src={msg.media_url} isOutgoing={isOutbound} />
                          </div>
                        )}
                        {(msg.media_type === "audio" || msg.media_type === "ptt") && !msg.media_url && (
                          <div className="flex items-center gap-2 px-2.5 pt-2">
                            <Mic className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Áudio</span>
                          </div>
                        )}
                        {msg.media_type === "document" && msg.media_url && (
                          <a
                            href={msg.media_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-2.5 pt-2 hover:underline"
                          >
                            <File className="size-5 text-muted-foreground shrink-0" />
                            <span className="text-[13px] truncate max-w-[180px]">
                              Abrir documento
                            </span>
                          </a>
                        )}
                        {msg.media_type === "document" && !msg.media_url && (
                          <div className="flex items-center gap-2 px-2.5 pt-2">
                            <File className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Documento</span>
                          </div>
                        )}
                        {msg.media_type === "sticker" && msg.media_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={msg.media_url} alt="Sticker" className="size-28 object-contain p-1" />
                        )}
                        {/* Text / caption / inline edit */}
                        <div className="px-2.5 py-1.5 text-[14.2px] leading-5">
                          {editingMsgId === msg.id ? (
                            <div className="flex flex-col gap-1">
                              <textarea
                                autoFocus
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleConfirmEdit(msg); }
                                  if (e.key === "Escape") setEditingMsgId(null);
                                }}
                                rows={2}
                                className="w-full resize-none rounded bg-black/10 px-2 py-1 text-[14px] leading-5 outline-none"
                              />
                              <div className="flex justify-end gap-1">
                                <button type="button" onClick={() => setEditingMsgId(null)} className="text-[11px] opacity-60 hover:opacity-90 px-2">Cancelar</button>
                                <button type="button" onClick={() => handleConfirmEdit(msg)} className="text-[11px] font-medium hover:opacity-80 px-2">Salvar</button>
                              </div>
                            </div>
                          ) : (
                            msg.text && (
                              <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            )
                          )}
                          <span
                            className="text-[10px] float-right ml-2 mt-1"
                            style={{ color: "var(--chat-timestamp)" }}
                          >
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            });
          })()}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Reply context bar */}
      {replyTo && (
        <div
          className="shrink-0 flex items-center gap-2 px-4 py-2 text-xs border-t border-[color:var(--chat-sidebar-divider)]"
          style={{ background: "var(--chat-input-bar-bg)" }}
        >
          <Reply className="size-3 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground truncate flex-1">
            Respondendo{replyTo.sender_name ? ` a ${replyTo.sender_name}` : ""}:{" "}
            {replyTo.text?.slice(0, 60) ?? "[mídia]"}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-5 shrink-0"
            onClick={() => setReplyTo(null)}
          >
            <X className="size-3" />
          </Button>
        </div>
      )}

      {/* Media preview bar */}
      {attachedFile && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-[color:var(--chat-sidebar-divider)]"
          style={{ background: "var(--chat-input-bar-bg)" }}
        >
          {attachedPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachedPreview}
              alt="preview"
              className="h-14 w-14 rounded object-cover border shrink-0"
            />
          ) : (
            <div className="h-14 w-14 rounded border bg-background flex items-center justify-center shrink-0">
              {attachedMediaType === "video" ? (
                <ImageIcon className="size-5 text-muted-foreground" />
              ) : attachedMediaType === "audio" ? (
                <Mic className="size-5 text-muted-foreground" />
              ) : (
                <FileText className="size-5 text-muted-foreground" />
              )}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{attachedFile.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {attachedMediaType} {"\u00B7"} {(attachedFile.size / 1024).toFixed(0)} KB
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0"
            onClick={clearAttachment}
          >
            <X className="size-3" />
          </Button>
        </div>
      )}

      {/* Input bar */}
      <div
        className="shrink-0 border-t border-[color:var(--chat-sidebar-divider)] px-3 py-2"
        style={{ background: "var(--chat-input-bar-bg)" }}
      >
        {/* Separate hidden file inputs */}
        <input ref={imageInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileSelect} />
        <input ref={audioFileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden" onChange={handleFileSelect} />

        <div className="flex items-end gap-1">
          {/* + structured menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="size-10 shrink-0 rounded-full flex items-center justify-center hover:bg-black/10 transition-colors disabled:opacity-50"
              style={{ color: "var(--chat-header-fg)" }}
              disabled={sendingMedia || isRecording}
            >
              {sendingMedia ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="size-4" />
                Foto / Vídeo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => audioFileInputRef.current?.click()}>
                <Mic className="size-4" />
                Enviar áudio
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <FileText className="size-4" />
                Documento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Emoji picker */}
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 rounded-full hover:bg-transparent"
                style={{ color: "var(--chat-header-fg)" }}
                disabled={isRecording}
              >
                <Smile className="size-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto p-0 border-0">
              <EmojiPicker
                onEmojiClick={(d) => {
                  setChatInput((prev) => prev + d.emoji);
                  setEmojiOpen(false);
                  inputRef.current?.focus();
                }}
                width={320}
                height={400}
                searchPlaceholder="Buscar emoji..."
                previewConfig={{ showPreview: false }}
              />
            </PopoverContent>
          </Popover>

          {/* Textarea or recording indicator */}
          {isRecording ? (
            <div
              className="flex-1 flex items-center justify-between gap-2 rounded-lg px-4 py-[11px]"
              style={{ background: "var(--chat-input-field-bg)" }}
            >
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-destructive animate-pulse shrink-0" />
                <span className="text-sm" style={{ color: "var(--chat-header-fg)" }}>
                  Gravando {formatRecordingTime(recordingSeconds)}
                </span>
              </div>
              <Button variant="ghost" size="icon-sm" className="size-6 shrink-0" onClick={handleCancelRecording}>
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <Textarea
              ref={inputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={attachedFile ? "Legenda (opcional)..." : "Digite uma mensagem..."}
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-lg px-4 py-[11px] text-[15px] leading-5 outline-none"
              style={{
                background: "var(--chat-input-field-bg)",
                color: "var(--chat-header-fg)",
                border: "none",
                boxShadow: "none",
              }}
              rows={1}
              disabled={sendingMessage || sendingMedia}
            />
          )}

          {/* Send / Stop recording / Mic button */}
          {isRecording ? (
            <Button
              size="icon"
              onClick={handleStopRecording}
              className="size-10 shrink-0 rounded-full hover:opacity-90"
              style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
            >
              <Square className="size-4 fill-current" />
            </Button>
          ) : chatInput.trim() || attachedFile ? (
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={sendingMessage || sendingMedia}
              className="size-10 shrink-0 rounded-full hover:opacity-90 disabled:opacity-70"
              style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
            >
              {sendingMessage ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleStartRecording}
              className="size-10 shrink-0 rounded-full hover:opacity-90"
              style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
            >
              <Mic className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Settings Sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Configurações do Grupo</SheetTitle>
            <SheetDescription>
              Edite nome, descrição, categoria e comportamento do grupo.
            </SheetDescription>
          </SheetHeader>
          <div className="px-card py-6 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Identidade
              </p>
              <div className="space-y-form">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Descrição</Label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="min-h-16"
                    placeholder="Descrição..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select
                    value={editCategory}
                    onValueChange={(v) => setEditCategory(v ?? "geral")}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {CATEGORY_LABELS[editCategory] ?? "Selecione"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="geral">Geral</SelectItem>
                      <SelectItem value="aquecimento">Aquecimento</SelectItem>
                      <SelectItem value="evento">Evento</SelectItem>
                      <SelectItem value="oferta">Oferta</SelectItem>
                      <SelectItem value="alunos">Alunos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Comportamento
              </p>
              <div className="rounded-lg border divide-y">
                <div className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-2">
                    <Megaphone className="size-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Modo Anúncio</p>
                      <p className="text-xs text-muted-foreground">Só admins enviam mensagens</p>
                    </div>
                  </div>
                  <Switch checked={editAnnounce} onCheckedChange={setEditAnnounce} />
                </div>
                <div className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium">Bloquear grupo</p>
                      <p className="text-xs text-muted-foreground">
                        Só admins editam info do grupo
                      </p>
                    </div>
                  </div>
                  <Switch checked={editLocked} onCheckedChange={setEditLocked} />
                </div>
              </div>
            </div>

            <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              {saving ? "Salvando..." : "Salvar configurações"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link de Convite</DialogTitle>
            <DialogDescription>
              Obtenha ou renove o link e envie para um lead diretamente pelo WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={inviteLink}
                readOnly
                placeholder="Clique em obter link..."
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(inviteLink);
                  toast.success("Copiado!");
                }}
                disabled={!inviteLink}
              >
                <Copy className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={inviteLink ? handleResetInviteLink : handleGetInviteLink}
                disabled={resettingLink}
              >
                {resettingLink ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>Enviar convite para lead</Label>
              <Select
                value={selectedLeadId}
                onValueChange={(v) => setSelectedLeadId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecionar lead..." />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.name} {lead.phone ? `(${lead.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleSendInvite} disabled={sendingInvite || !selectedLeadId}>
              {sendingInvite ? "Enviando..." : "Enviar convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
