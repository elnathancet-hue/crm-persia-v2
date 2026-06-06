"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Copy,
  ExternalLink,
  File,
  FileText,
  FileVideo,
  Image,
  Bell,
  Heart,
  Loader2,
  Pause,
  Play,
  Lock,
  LogOut,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Square,
  Trash2,
  Users,
  UserCircle,
  UserPlus,
  Link2,
  Save,
  X,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
import { Checkbox } from "@persia/ui/checkbox";
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
  syncGroups,
  deleteGroup,
  sendMessageToGroup,
  sendMediaToGroup,
  deleteGroupMessage,
  reactToGroupMessage,
  pinGroupMessage,
  getInviteLink,
  leaveGroup,
  updateGroup,
  sendInviteToLead,
  createGroupCampaign,
  updateGroupCampaign,
  deleteGroupCampaign,
  linkGroupToCampaign,
  setGroupCapacity,
  getGroupMessages,
  getGroupLeadMembers,
  backfillGroupMembers,
  generateGroupMessageDraft,
  scheduleGroupMessage,
  getScheduledGroupMessages,
  cancelScheduledGroupMessage,
  type GroupCampaign,
  type GroupLeadMember,
} from "@/actions/groups";
import { LeadContactPanel, type LeadContactData } from "@/components/chat/lead-contact-panel";
import { cn } from "@/lib/utils";
import { useNotificationSound } from "@/lib/hooks/use-notification";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface Group {
  id: string;
  organization_id: string;
  group_jid: string;
  name: string;
  description: string | null;
  invite_link: string | null;
  participant_count: number;
  max_participants: number;
  is_accepting: boolean;
  is_announce: boolean;
  is_locked: boolean;
  is_join_approval_required: boolean;
  member_add_mode: "all_member_add" | "admin_add";
  ephemeral_duration: "off" | "1d" | "7d" | "90d";
  category: string;
  campaign_id: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
  last_message_text: string | null;
  last_message_sender: string | null;
  last_message_direction: string | null;
  last_message_at: string | null;
}

interface GroupLastMsg {
  text: string | null;
  sender: string | null;
  direction: string;
  at: string;
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
  sender_identity_kind: "phone" | "lid" | "unknown";
  sender_avatar_url: string | null;
  created_at: string;
  whatsapp_msg_id: string | null;
  media_url: string | null;
  media_type: string | null;
  reply_to_whatsapp_msg_id: string | null;
  is_pinned?: boolean | null;
  status?: string | null;
  sender_lead?: GroupMessageSenderLead | null;
}

const EmojiPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => <div className="p-4 text-xs text-muted-foreground">Carregando emojis...</div>,
});

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "💪"];

const SENDER_COLORS = [
  { bg: "#ec4899", fg: "#ffffff" },
  { bg: "#84cc16", fg: "#ffffff" },
  { bg: "#06b6d4", fg: "#ffffff" },
  { bg: "#f97316", fg: "#ffffff" },
  { bg: "#8b5cf6", fg: "#ffffff" },
  { bg: "#10b981", fg: "#ffffff" },
  { bg: "#ef4444", fg: "#ffffff" },
  { bg: "#0ea5e9", fg: "#ffffff" },
];

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

interface GroupMessageSenderLead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  status: string | null;
}

async function enrichGroupMessagesWithLeads(
  supabase: ReturnType<typeof createClient>,
  groupId: string,
  rows: GroupMessage[],
): Promise<GroupMessage[]> {
  const leadIds = Array.from(
    new Set(
      rows
        .map((row) => row.sender_lead_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const phones = Array.from(
    new Set(
      rows
        .filter((row) => !row.sender_lead_id)
        .map((row) => row.sender_phone)
        .filter((phone): phone is string => Boolean(phone)),
    ),
  );

  if (leadIds.length === 0 && phones.length === 0) {
    return resolveSignedMediaUrls(supabase, rows);
  }

  const leadsById = new Map<string, GroupMessageSenderLead>();
  if (leadIds.length > 0) {
    const { data } = await supabase
      .from("leads")
      .select("id, name, phone, email, avatar_url, status")
      .in("id", leadIds);

    for (const lead of (data ?? []) as GroupMessageSenderLead[]) {
      leadsById.set(lead.id, lead);
    }
  }

  const membershipByPhone = new Map<
    string,
    {
      id: string;
      lead_id: string | null;
      avatar_url: string | null;
      leads: GroupMessageSenderLead | null;
    }
  >();
  if (phones.length > 0) {
    const { data } = await (supabase as any)
      .from("group_memberships")
      .select("id, phone, lead_id, avatar_url, leads(id, name, phone, email, avatar_url, status)")
      .eq("group_id", groupId)
      .in("phone", phones)
      .is("left_at", null);

    for (const membership of (data ?? []) as Array<{
      id: string;
      phone: string | null;
      lead_id: string | null;
      avatar_url: string | null;
      leads: GroupMessageSenderLead | null;
    }>) {
      if (membership.phone) membershipByPhone.set(membership.phone, membership);
      if (membership.leads) leadsById.set(membership.leads.id, membership.leads);
    }
  }

  const enriched = rows.map((row) => ({
    ...row,
    sender_membership_id:
      row.sender_membership_id ??
      (row.sender_phone ? membershipByPhone.get(row.sender_phone)?.id ?? null : null),
    sender_lead_id:
      row.sender_lead_id ??
      (row.sender_phone ? membershipByPhone.get(row.sender_phone)?.lead_id ?? null : null),
    sender_avatar_url:
      row.sender_avatar_url ??
      (row.sender_phone ? membershipByPhone.get(row.sender_phone)?.avatar_url ?? null : null),
    sender_lead:
      (row.sender_lead_id ? leadsById.get(row.sender_lead_id) : null) ??
      (row.sender_phone ? membershipByPhone.get(row.sender_phone)?.leads ?? null : null),
  }));
  return resolveSignedMediaUrls(supabase, enriched);
}

async function resolveSignedMediaUrls(
  supabase: ReturnType<typeof createClient>,
  rows: GroupMessage[],
): Promise<GroupMessage[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (!row.media_url?.startsWith("chat-media:")) return row;
      const path = row.media_url.slice("chat-media:".length).replace(/^\/+/, "");
      const { data } = await (supabase as any).storage
        .from("chat-media")
        .createSignedUrl(path, 3600);
      return data?.signedUrl ? { ...row, media_url: data.signedUrl as string } : row;
    }),
  );
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const messageKey = dateKeyInChatTimeZone(d);
  if (messageKey === dateKeyInChatTimeZone(now)) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: CHAT_TIME_ZONE });
  }
  if (messageKey === dateKeyInChatTimeZone(addDays(now, -1))) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: CHAT_TIME_ZONE });
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

function senderColorForKey(key: string | null | undefined): { bg: string; fg: string } {
  const value = key || "unknown";
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

const GROUP_AVATAR_COLORS = [
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

function hashGroupColor(name: string | null): string {
  if (!name) return GROUP_AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GROUP_AVATAR_COLORS[Math.abs(hash) % GROUP_AVATAR_COLORS.length];
}

const CATEGORY_LABELS: Record<string, string> = {
  geral: "Geral",
  aquecimento: "Aquecimento",
  evento: "Evento",
  oferta: "Oferta",
  alunos: "Alunos",
};

const CATEGORY_COLORS: Record<string, string> = {
  geral: "bg-muted text-muted-foreground",
  aquecimento: "bg-warning-soft text-warning-soft-foreground",
  evento: "bg-primary/10 text-primary",
  oferta: "bg-success-soft text-success-soft-foreground",
  alunos: "bg-progress-soft text-progress-soft-foreground",
};

function GroupMsgStatusIcon({ status }: { status: string }) {
  if (status === "failed") {
    return <AlertCircle className="inline size-3.5 shrink-0 text-destructive" aria-label="Falha no envio" />;
  }
  if (status === "read") {
    return (
      <CheckCheck
        className="inline size-3.5 shrink-0"
        style={{ color: "var(--chat-checkmark-read)" }}
        aria-label="Lido"
      />
    );
  }
  if (status === "delivered") {
    return (
      <CheckCheck
        className="inline size-3.5 shrink-0"
        style={{ color: "var(--chat-checkmark-default)" }}
        aria-label="Entregue"
      />
    );
  }
  return (
    <Check
      className="inline size-3 shrink-0"
      style={{ color: "var(--chat-checkmark-default)" }}
      aria-label="Enviado"
    />
  );
}

// â"€â"€â"€ Left panel: group list â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function GroupListPanel({
  groups,
  selectedId,
  onSelect,
  onSync,
  syncing,
  search,
  onSearch,
  categoryFilter,
  onCategoryFilter,
  unreadCounts,
  lastMessages,
}: {
  groups: Group[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSync: () => void;
  syncing: boolean;
  search: string;
  onSearch: (v: string) => void;
  categoryFilter: string;
  onCategoryFilter: (v: string) => void;
  unreadCounts: Record<string, number>;
  lastMessages: Record<string, GroupLastMsg>;
}) {
  const filtered = groups.filter((g) => {
    const matchesSearch = g.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "todos" || g.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--chat-sidebar-bg)" }}>
      {/* Header */}
      <div
        className="flex h-[59px] shrink-0 items-center gap-3 border-b border-[color:var(--chat-sidebar-divider)] px-4"
        style={{ background: "var(--chat-header-bg)" }}
      >
        <Users className="size-5 text-[color:var(--chat-send-bg)]" />
        <h2 className="text-base font-medium text-[color:var(--chat-header-fg)] flex-1">
          Grupos WhatsApp
        </h2>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" onClick={onSync} disabled={syncing} title="Sincronizar">
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Category filter */}
      <div className="shrink-0 border-b border-[color:var(--chat-sidebar-divider)] px-3 py-2">
        <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
          {["todos", "geral", "aquecimento", "evento", "oferta", "alunos"].map((cat) => (
            <Button
              key={cat}
              variant="ghost"
              onClick={() => onCategoryFilter(cat)}
              className={`shrink-0 h-7 text-xs px-2.5 rounded-full transition-colors ${
                categoryFilter === cat
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  : "bg-[color:var(--chat-input-field-bg)] text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat === "todos" ? "Todos" : CATEGORY_LABELS[cat]}
            </Button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-[color:var(--chat-sidebar-divider)] px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="search"
            placeholder="Buscar grupo..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="h-9 rounded-lg border-0 bg-[color:var(--chat-input-field-bg)] pl-8 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-[color:var(--chat-send-bg)]"
          />
        </div>
      </div>

      {/* Group list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              variant="subtle"
              icon={<Users />}
              title="Nenhum grupo"
              description={
                search || categoryFilter !== "todos"
                  ? "Tente outro filtro"
                  : "Crie ou sincronize grupos do WhatsApp"
              }
            />
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((group) => {
              const lastMsg = lastMessages[group.id];
              const unread = unreadCounts[group.id] ?? 0;
              const isSelected = selectedId === group.id;
              const timeLabel = lastMsg ? formatMsgTime(lastMsg.at) : "";
              const preview = lastMsg
                ? lastMsg.direction === "outbound"
                  ? `Você: ${lastMsg.text || "Mídia"}`
                  : lastMsg.sender
                    ? `${lastMsg.sender.split(" ")[0]}: ${lastMsg.text || "Mídia"}`
                    : lastMsg.text || "Mídia"
                : "Nenhuma mensagem";
              const colorClass = hashGroupColor(group.name);

              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => onSelect(group.id)}
                  className="w-full text-left flex min-h-[72px] items-start gap-3 border-b border-[color:var(--chat-sidebar-divider)] px-3 py-2.5 transition-colors"
                  style={{ background: isSelected ? "var(--chat-sidebar-active)" : "transparent" }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "var(--chat-sidebar-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0 mt-0.5">
                    <Avatar size="default">
                      {safeAvatarUrl(group.image_url) ? (
                        <AvatarImage src={safeAvatarUrl(group.image_url)!} alt={group.name} />
                      ) : null}
                      <AvatarFallback className={`${colorClass} text-white`}>
                        {initialsFromName(group.name)}
                      </AvatarFallback>
                    </Avatar>
                    {/* Unread dot */}
                    {unread > 0 && (
                      <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-primary" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {/* Row 1: name + time */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[15px] font-medium leading-5 text-[color:var(--chat-header-fg)]">
                        {group.name}
                      </span>
                      {timeLabel && (
                        <span className={`shrink-0 text-[11px] ${unread > 0 ? "text-primary font-medium" : "text-muted-foreground"}`}>
                          {timeLabel}
                        </span>
                      )}
                    </div>
                    {/* Row 2: preview + unread count */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] leading-5 text-muted-foreground">
                        {preview}
                      </span>
                      {unread > 0 && (
                        <span
                          className="inline-flex shrink-0 items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1"
                          style={{ background: "var(--badge-notification)", color: "var(--badge-notification-fg)" }}
                        >
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </div>
                    {/* Row 3: category + flags */}
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Badge variant="secondary" className="h-4 px-1 text-[10px] capitalize">
                        {CATEGORY_LABELS[group.category] || group.category}
                      </Badge>
                      {group.is_announce && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          Anúncio
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer count */}
      <div className="px-4 py-2 border-t border-[color:var(--chat-sidebar-divider)] text-xs text-muted-foreground">
        {groups.length} grupos
      </div>
    </div>
  );
}

// â"€â"€â"€ Right panel: empty state â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function GroupEmptyState() {
  return (
    <div className="flex items-center justify-center h-full">
      <EmptyState
        variant="subtle"
        icon={<MessageSquare />}
        title="Selecione um grupo"
        description="Escolha um grupo na lista para ver o chat"
      />
    </div>
  );
}

// â"€â"€â"€ Right panel: group chat â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// ─── Audio player (same as chat-window.tsx) ──────────────────────────────────

const WAVEFORM = [3, 5, 8, 6, 10, 7, 12, 9, 14, 11, 16, 13, 15, 10, 12, 8, 6, 9, 11, 14, 12, 10, 7, 9, 11, 8, 6, 5, 8, 10, 7, 5];

function AudioPlayer({ src, isOutgoing }: { src: string; isOutgoing: boolean }) {
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

  return (
    <div className="flex items-center gap-2.5 w-full px-2.5 py-1.5">
      <button
        type="button"
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
            type="button"
            onClick={cycleRate}
            className="text-[10px] tabular-nums font-medium rounded-full px-1.5 py-0.5 hover:opacity-80"
            style={{ background: isOutgoing ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.08)" }}
          >
            {rate.toFixed(1).replace(".", ",") + "x"}
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

// ─────────────────────────────────────────────────────────────────────────────

function GroupChatPanel({
  group,
  leads,
  onBack,
  onDelete,
  onLeave,
}: {
  group: Group;
  leads: Lead[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onLeave: (id: string) => void;
}) {
  const [messages, setMessages] = React.useState<GroupMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = React.useState(true);
  const [chatInput, setChatInput] = React.useState("");
  const [sendingMessage, setSendingMessage] = React.useState(false);
  const [sendingMedia, setSendingMedia] = React.useState(false);
  const [attachedFile, setAttachedFile] = React.useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = React.useState<string | null>(null);
  const [attachedMediaType, setAttachedMediaType] = React.useState<"image" | "video" | "audio" | "document">("document");
  const [reactingMsgId, setReactingMsgId] = React.useState<string | null>(null);
  const [replyTo, setReplyTo] = React.useState<GroupMessage | null>(null);
  const [messageSearch, setMessageSearch] = React.useState("");
  const [deleteDialogMsg, setDeleteDialogMsg] = React.useState<GroupMessage | null>(null);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [aiDraft, setAiDraft] = React.useState("");
  const [aiLoading, setAiLoading] = React.useState(false);
  const [isRecording, setIsRecording] = React.useState(false);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const [bulkSelectMode, setBulkSelectMode] = React.useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = React.useState<Set<string>>(new Set());
  const [deletingBulk, setDeletingBulk] = React.useState(false);
  const [schedulePopoverOpen, setSchedulePopoverOpen] = React.useState(false);
  const [scheduleAt, setScheduleAt] = React.useState("");
  const [schedulingMessage, setSchedulingMessage] = React.useState(false);
  const [scheduledList, setScheduledList] = React.useState<Array<{ id: string; content: string; scheduled_at: string; status: string; error_message: string | null; created_at: string }>>([]);
  const [loadingScheduled, setLoadingScheduled] = React.useState(false);
  const [hasMoreMessages, setHasMoreMessages] = React.useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const messagesScrollRef = React.useRef<HTMLDivElement>(null);
  const shouldAutoScroll = React.useRef(true);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const aiTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const audioFileInputRef = React.useRef<HTMLInputElement>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const recordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const { play: playNotification } = useNotificationSound();

  // Settings sheet state
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [editName, setEditName] = React.useState(group.name);
  const [editDescription, setEditDescription] = React.useState(group.description || "");
  const [editAnnounce, setEditAnnounce] = React.useState(group.is_announce);
  const [editCategory, setEditCategory] = React.useState(group.category);
  const [saving, setSaving] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState(group.invite_link || "");
  const [editLocked, setEditLocked] = React.useState(group.is_locked);
  const [editJoinApproval, setEditJoinApproval] = React.useState(group.is_join_approval_required);
  const [editMemberAddMode, setEditMemberAddMode] = React.useState<"all_member_add" | "admin_add">(group.member_add_mode);
  const [editEphemeral, setEditEphemeral] = React.useState<"off" | "1d" | "7d" | "90d">(group.ephemeral_duration);
  const [leavingGroup, setLeavingGroup] = React.useState(false);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selectedLeadId, setSelectedLeadId] = React.useState("");
  const [sendingInvite, setSendingInvite] = React.useState(false);

  // Member contact panel
  const [membersOpen, setMembersOpen] = React.useState(false);
  const [groupMembers, setGroupMembers] = React.useState<GroupLeadMember[]>([]);
  const [membersLoading, setMembersLoading] = React.useState(false);
  const [selectedMember, setSelectedMember] = React.useState<GroupLeadMember | null>(null);
  const [selectedContact, setSelectedContact] = React.useState<LeadContactData | null>(null);
  const [backfillLoading, setBackfillLoading] = React.useState(false);

  // Reset when group changes
  React.useEffect(() => {
    setEditName(group.name);
    setEditDescription(group.description || "");
    setEditAnnounce(group.is_announce);
    setEditCategory(group.category);
    setInviteLink(group.invite_link || "");
    setEditLocked(group.is_locked);
    setEditJoinApproval(group.is_join_approval_required);
    setEditMemberAddMode(group.member_add_mode);
    setEditEphemeral(group.ephemeral_duration);
    setMembersOpen(false);
    setSelectedMember(null);
    setSelectedContact(null);
    setGroupMembers([]);
    setReplyTo(null);
    setAiOpen(false);
    setAiPrompt("");
    setAiDraft("");
  }, [group.id]);

  // Load initial messages
  React.useEffect(() => {
    setLoadingMsgs(true);
    setMessages([]);
    setHasMoreMessages(false);
    const supabase = createClient();
    getGroupMessages(group.id)
      .then(({ messages: data, hasMore }) => {
        setMessages(data as GroupMessage[]);
        setHasMoreMessages(hasMore);
        setLoadingMsgs(false);
      })
      .catch(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("group_messages")
      .select("id, direction, text, sender_name, sender_jid, sender_phone, sender_lead_id, sender_membership_id, sender_identity_kind, sender_avatar_url, created_at, whatsapp_msg_id, media_url, media_type, reply_to_whatsapp_msg_id, is_pinned, status")
      .eq("group_id", group.id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
      .limit(50)
      .then(async ({ data }: { data: GroupMessage[] | null }) => {
        const enriched = await enrichGroupMessagesWithLeads(supabase, group.id, data || []);
        setMessages(enriched);
        setLoadingMsgs(false);
      })
      .catch(() => {
        (supabase as any)
          .from("group_messages")
          .select("id, direction, text, sender_name, created_at, whatsapp_msg_id, media_url, media_type")
          .eq("group_id", group.id)
          .eq("is_deleted", false)
          .order("created_at", { ascending: true })
          .limit(50)
          .then(({ data }: { data: GroupMessage[] | null }) => {
            setMessages(
              (data || []).map((message) => ({
                ...message,
                sender_jid: null,
                sender_phone: null,
                sender_lead_id: null,
                sender_membership_id: null,
                sender_identity_kind: "unknown",
                sender_avatar_url: null,
                reply_to_whatsapp_msg_id: null,
                is_pinned: null,
                sender_lead: null,
              })),
            );
          });
        setLoadingMsgs(false);
      });
      });
  }, [group.id]);

  // Realtime subscription
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`group_messages:${group.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${group.id}` },
        (payload: { new: GroupMessage }) => {
          enrichGroupMessagesWithLeads(supabase, group.id, [payload.new]).then(([message]) => {
            if (!message) return;
            setMessages((prev) => {
              if (prev.some((m) => m.id === message.id)) return prev;
              return [...prev, message];
            });
            if (message.direction === "inbound") playNotification();
          }).catch(() => {
            // Best-effort — just append raw message without enrichment
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
          });
          // Não dispara toast aqui — o grupo está aberto e o usuário vê a mensagem
          // em tempo real. O toast para grupos não selecionados é gerenciado pelo
          // GlobalRealtimeSubscription em GroupsClient.
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "group_messages", filter: `group_id=eq.${group.id}` },
        (payload: { new: GroupMessage }) => {
          enrichGroupMessagesWithLeads(supabase, group.id, [payload.new]).then(([message]) => {
            if (!message) return;
            setMessages((prev) =>
              prev.map((existing) => existing.id === message.id ? message : existing),
            );
          }).catch(() => {
            setMessages((prev) =>
              prev.map((existing) => existing.id === payload.new.id ? payload.new : existing),
            );
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [group.id]);

  // Scroll to bottom on initial load / new outbound messages
  React.useEffect(() => {
    if (!loadingMsgs && shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loadingMsgs]);

  const handleLoadOlderMessages = React.useCallback(async () => {
    if (loadingOlderMessages || messages.length === 0) return;
    const scrollEl = messagesScrollRef.current;
    const previousScrollHeight = scrollEl?.scrollHeight ?? 0;
    const before = messages[0]?.created_at;
    if (!before) return;

    setLoadingOlderMessages(true);
    try {
      const { messages: older, hasMore } = await getGroupMessages(group.id, { before });
      setHasMoreMessages(hasMore);
      if (older.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = (older as GroupMessage[]).filter((m) => !existingIds.has(m.id));
          return [...newMsgs, ...prev];
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
  }, [group.id, loadingOlderMessages, messages]);

  // Auto-focus AI prompt textarea when panel opens
  React.useEffect(() => {
    if (aiOpen) {
      setTimeout(() => aiTextareaRef.current?.focus(), 50);
    }
  }, [aiOpen]);

  const adjustHeight = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  function clearAttachment() {
    setAttachedFile(null);
    setAttachedPreview(null);
  }

  async function handleSendMessage() {
    if (attachedFile) {
      const caption = chatInput.trim() || undefined;
      const file = attachedFile;
      const mt = attachedMediaType;
      const replyingTo = replyTo;
      clearAttachment();
      setChatInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setReplyTo(null);
      shouldAutoScroll.current = true;
      setSendingMedia(true);
      try {
        const formData = new FormData();
        formData.append("groupId", group.id);
        formData.append("file", file);
        formData.append("mediaType", mt);
        if (caption) formData.append("caption", caption);
        if (replyingTo?.whatsapp_msg_id) formData.append("replyToWamid", replyingTo.whatsapp_msg_id);
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
    shouldAutoScroll.current = true;
    setSendingMessage(true);
    setChatInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const replyingTo = replyTo;
    setReplyTo(null);
    try {
      const result = await sendMessageToGroup(group.id, text, replyingTo?.whatsapp_msg_id ?? null);
      if (result.error) {
        toast.error(result.error);
        setChatInput(text);
        setReplyTo(replyingTo);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
      setChatInput(text);
      setReplyTo(replyingTo);
    } finally {
      setSendingMessage(false);
    }
  }

  function formatRecordingTime(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  async function handleStartRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
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
          toast.success("\u00C1udio enviado");
        } catch (err: any) {
          toast.error(err.message || "Erro ao enviar \u00E1udio");
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
      toast.error("N\u00E3o foi poss\u00EDvel acessar o microfone");
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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    let mediaType: "image" | "video" | "audio" | "document" = "document";
    if (file.type.startsWith("image/")) mediaType = "image";
    else if (file.type.startsWith("video/")) mediaType = "video";
    else if (file.type.startsWith("audio/")) mediaType = "audio";

    setAttachedMediaType(mediaType);
    setAttachedFile(file);
    if (mediaType === "image") {
      const reader = new FileReader();
      reader.onload = (ev) => setAttachedPreview((ev.target?.result as string) ?? null);
      reader.readAsDataURL(file);
    } else {
      setAttachedPreview(null);
    }
  }

  async function handleGenerateAiDraft() {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    setAiLoading(true);
    setAiDraft("");
    try {
      const result = await generateGroupMessageDraft(group.id, prompt);
      if (result.error) {
        toast.error(result.error);
      } else {
        setAiDraft(result.suggestion);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao gerar sugestão");
    } finally {
      setAiLoading(false);
    }
  }

  function getMessagePreview(msg: GroupMessage | null | undefined): string {
    if (!msg) return "Mensagem";
    if (msg.text?.trim()) return msg.text.trim();
    if (msg.media_type === "image") return "Imagem";
    if (msg.media_type === "video") return "Video";
    if (msg.media_type === "audio") return "Audio";
    if (msg.media_type === "document") return "Documento";
    return "Midia";
  }

  function getSenderLabel(msg: GroupMessage | null | undefined): string {
    if (!msg) return "Mensagem";
    if (msg.direction === "outbound") return "Voce";
    return msg.sender_lead?.name ?? msg.sender_name ?? msg.sender_phone ?? "Participante";
  }

  async function handleReact(msg: GroupMessage, emoji: string) {
    if (!msg.whatsapp_msg_id) return;
    setReactingMsgId(null);
    try {
      await reactToGroupMessage(group.id, msg.whatsapp_msg_id, emoji);
    } catch {
      toast.error("Erro ao enviar reação");
    }
  }

  async function handleDeleteMessage(msg: GroupMessage) {
    // Optimistic: remove from local state immediately
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    try {
      await deleteGroupMessage(group.id, msg.id, msg.whatsapp_msg_id);
    } catch {
      // Restore message on failure
      setMessages((prev) => {
        const restored = [...prev, msg].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        return restored;
      });
      toast.error("Erro ao apagar mensagem");
    }
  }

  async function handlePinMessage(msgId: string, wamid: string | null, pin: boolean) {
    if (!wamid) { toast.error("Mensagem sem ID WhatsApp"); return; }
    try {
      await pinGroupMessage(group.id, msgId, wamid, pin);
      setMessages((prev) => prev.map((m) => ({
        ...m,
        is_pinned: pin ? m.id === msgId : (m.id === msgId ? false : m.is_pinned),
      })));
      toast.success(pin ? "Mensagem fixada" : "Mensagem desafixada");
    } catch {
      toast.error("Erro ao fixar mensagem");
    }
  }

  function toggleBulkSelect(msgId: string) {
    setSelectedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      return next;
    });
  }

  function exitBulkSelect() {
    setBulkSelectMode(false);
    setSelectedMsgIds(new Set());
  }

  async function handleBulkDelete() {
    if (selectedMsgIds.size === 0) return;
    setDeletingBulk(true);
    const msgsToDelete = messages.filter((m) => selectedMsgIds.has(m.id));
    // Optimistic removal
    setMessages((prev) => prev.filter((m) => !selectedMsgIds.has(m.id)));
    exitBulkSelect();
    try {
      await Promise.allSettled(
        msgsToDelete.map((m) => deleteGroupMessage(group.id, m.id, m.whatsapp_msg_id))
      );
    } catch {
      // Best-effort — Realtime UPDATE will correct state if needed
    } finally {
      setDeletingBulk(false);
    }
  }

  async function handleScheduleMessage() {
    if (!chatInput.trim() || !scheduleAt) return;
    setSchedulingMessage(true);
    try {
      await scheduleGroupMessage(group.id, chatInput.trim(), new Date(scheduleAt).toISOString());
      toast.success("Mensagem agendada");
      setChatInput("");
      setScheduleAt("");
      setSchedulePopoverOpen(false);
    } catch {
      toast.error("Erro ao agendar mensagem");
    } finally {
      setSchedulingMessage(false);
    }
  }

  async function handleLoadScheduled() {
    setLoadingScheduled(true);
    try {
      const list = await getScheduledGroupMessages(group.id);
      setScheduledList(list);
    } catch {
      setScheduledList([]);
    } finally {
      setLoadingScheduled(false);
    }
  }

  async function handleCancelScheduled(msgId: string) {
    try {
      await cancelScheduledGroupMessage(msgId);
      setScheduledList((prev) => prev.filter((m) => m.id !== msgId));
      toast.success("Agendamento cancelado");
    } catch {
      toast.error("Erro ao cancelar agendamento");
    }
  }

  async function loadGroupContacts() {
    setMembersLoading(true);
    try {
      const members = await getGroupLeadMembers(group.id);
      setGroupMembers(members);
    } catch {
      setGroupMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }

  async function handleOpenMembers() {
    setMembersOpen(true);
    setSelectedMember(null);
    setSelectedContact(null);
    await loadGroupContacts();
  }

  async function handleOpenGroupDetails() {
    setSettingsOpen(true);
    setSelectedMember(null);
    setSelectedContact(null);
    if (groupMembers.length === 0) {
      await loadGroupContacts();
    }
  }

  function contactFromGroupMember(member: GroupLeadMember): LeadContactData {
    if (member.lead) {
      return {
        ...member.lead,
        phone: member.lead.phone ?? member.phone,
        avatar_url: member.lead.avatar_url ?? member.avatar_url,
      };
    }

    return {
      id: null,
      name: member.name,
      phone: member.phone,
      email: null,
      avatar_url: member.avatar_url,
      status: null,
      source: member.source ?? "whatsapp_group",
      created_at: member.joined_at,
      assigned_to: null,
      lead_tags: [],
    };
  }

  function handleOpenSenderContact(msg: GroupMessage) {
    const lead = msg.sender_lead;
    setMembersOpen(true);
    setSelectedMember(null);
    setSelectedContact(
      lead
        ? {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        avatar_url: lead.avatar_url,
        status: lead.status,
        source: null,
        created_at: msg.created_at,
        assigned_to: null,
        lead_tags: [],
        }
        : {
          id: null,
          name: msg.sender_name,
          phone: msg.sender_phone,
          email: null,
          avatar_url: msg.sender_avatar_url,
          status: null,
          source: "whatsapp_group",
          created_at: msg.created_at,
          assigned_to: null,
          lead_tags: [],
        },
    );
  }

  async function handleSaveSettings() {
    setSaving(true);
    try {
      await updateGroup(group.id, {
        name: editName.trim(),
        description: editDescription.trim(),
        is_announce: editAnnounce,
        locked: editLocked,
        join_approval_required: editJoinApproval,
        member_add_mode: editMemberAddMode,
        ephemeral_duration: editEphemeral,
        category: editCategory,
      });
      toast.success("Grupo atualizado");
      setSettingsOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
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

  async function handleLeaveGroup() {
    if (!confirm(`Sair do grupo "${group.name}"? O grupo será removido do CRM.`)) return;
    setLeavingGroup(true);
    try {
      await leaveGroup(group.id);
      toast.success("Saiu do grupo");
      setSettingsOpen(false);
      onLeave(group.id);
    } catch (err: any) {
      toast.error(err.message || "Erro ao sair do grupo");
      setLeavingGroup(false);
    }
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
    const today = new Date();
    const messageKey = dateKeyInChatTimeZone(d);
    if (messageKey === dateKeyInChatTimeZone(today)) return "Hoje";
    if (messageKey === dateKeyInChatTimeZone(addDays(today, -1))) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: CHAT_TIME_ZONE });
  }

  function isSameDay(a: string, b: string) {
    return dateKeyInChatTimeZone(new Date(a)) === dateKeyInChatTimeZone(new Date(b));
  }

  function formatFullDateTime(iso: string | null | undefined) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: CHAT_TIME_ZONE,
    });
  }

  function getMessageSenderKey(msg: GroupMessage): string {
    if (msg.direction === "outbound") return "outbound";
    return (
      msg.sender_lead_id ??
      msg.sender_membership_id ??
      msg.sender_phone ??
      msg.sender_jid ??
      msg.sender_name ??
      "unknown"
    );
  }

  const pinnedMessage = messages.find((m) => m.is_pinned) ?? null;
  const normalizedMessageSearch = messageSearch.trim().toLowerCase();
  const visibleMessages = normalizedMessageSearch
    ? messages.filter((msg) =>
        [msg.text, msg.sender_name, msg.sender_phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(normalizedMessageSearch)),
      )
    : messages;

  const messagesByWhatsAppId = new Map(
    messages
      .filter((message) => Boolean(message.whatsapp_msg_id))
      .map((message) => [message.whatsapp_msg_id as string, message]),
  );
  const mediaPreviewMessages = messages
    .filter((message) => Boolean(message.media_url))
    .slice(-4);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header â€" WhatsApp style matching chat-window */}
      <div
        className="flex h-[59px] shrink-0 items-center gap-3 border-b border-[color:var(--chat-sidebar-divider)] px-4"
        style={{ background: "var(--chat-header-bg)", color: "var(--chat-header-fg)" }}
      >
        <Button variant="ghost" size="icon-sm" onClick={onBack} className="md:hidden">
          <ArrowLeft className="size-4" />
        </Button>

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
            {group.is_announce && ` \u00B7 Anuncio`}
          </p>
        </div>

        <div className="relative hidden w-[200px] lg:block xl:w-[280px] shrink-0">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={messageSearch}
            onChange={(e) => setMessageSearch(e.target.value)}
            placeholder="Buscar na conversa..."
            className="h-9 rounded-lg bg-[color:var(--chat-input-field-bg)] pl-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Members contact panel toggle */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleOpenMembers}
            className={`size-8 rounded-lg hover:bg-muted ${membersOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            title="Contatos do grupo"
          >
            <UserCircle className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleOpenGroupDetails} title="Dados do grupo">
            <Settings className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setBulkSelectMode(true); setSelectedMsgIds(new Set()); }}>
                <Square className="size-4" />
                Selecionar mensagens
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => {
                if (group.invite_link) {
                  navigator.clipboard.writeText(group.invite_link);
                  toast.success("Link copiado!");
                } else {
                  toast.error("Sem link de convite. Obtenha nas configurações.");
                }
              }}>
                <Copy className="size-4" />
                Copiar link de convite
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(group.id)}>
                <Trash2 className="size-4" />
                Remover grupo
              </DropdownMenuItem>
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
            <p className="truncate text-xs text-muted-foreground">{pinnedMessage.text || "Mídia"}</p>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0"
            aria-label="Desafixar"
            onClick={() => handlePinMessage(pinnedMessage.id, pinnedMessage.whatsapp_msg_id, false)}
          >
            <X className="size-3" />
          </Button>
        </div>
      )}

      {/* Messages â€" WhatsApp wallpaper + bubble styling */}
      <div ref={messagesScrollRef} className="wa-chat-wallpaper flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-1 py-4">
          {messages.length > 0 && hasMoreMessages && (
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
                    <RefreshCw className="size-3.5" />
                    Carregar mensagens anteriores
                  </>
                )}
              </Button>
            </div>
          )}
          {loadingMsgs ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <EmptyState
                variant="subtle"
                icon={<MessageSquare />}
                title="Nenhuma mensagem ainda"
                description="Envie a primeira mensagem para o grupo"
              />
            </div>
          ) : (
            visibleMessages.map((msg, idx) => {
              const isOutbound = msg.direction === "outbound";
              const showDateSep = idx === 0 || !isSameDay(visibleMessages[idx - 1].created_at, msg.created_at);
              const previousMsg = idx > 0 ? visibleMessages[idx - 1] : null;
              const senderKey = getMessageSenderKey(msg);
              const continuesPreviousBlock =
                Boolean(previousMsg) &&
                !showDateSep &&
                previousMsg!.direction === msg.direction &&
                getMessageSenderKey(previousMsg!) === senderKey;
              const showBlockHeader = !continuesPreviousBlock;
              const senderLead = msg.sender_lead ?? null;
              const senderAvatarUrl = safeAvatarUrl(senderLead?.avatar_url ?? msg.sender_avatar_url);
              const senderDisplayName =
                senderLead?.name ??
                msg.sender_name ??
                msg.sender_phone ??
                (msg.sender_identity_kind === "lid" ? "Participante sem telefone" : "Participante");
              const senderColor = senderColorForKey(senderKey);
              const senderSecondary =
                senderLead?.phone ??
                msg.sender_phone ??
                (msg.sender_identity_kind === "lid" ? "Telefone nao disponivel" : null);
              const repliedMessage = msg.reply_to_whatsapp_msg_id
                ? messagesByWhatsAppId.get(msg.reply_to_whatsapp_msg_id) ?? null
                : null;

              return (
                <div
                  key={msg.id}
                  data-msg-id={msg.id}
                  className={bulkSelectMode ? "flex items-start gap-2 px-1" : undefined}
                  onClick={bulkSelectMode ? () => toggleBulkSelect(msg.id) : undefined}
                >
                  {bulkSelectMode && (
                    <div className="flex shrink-0 items-center pt-2">
                      <Checkbox
                        checked={selectedMsgIds.has(msg.id)}
                        onCheckedChange={() => toggleBulkSelect(msg.id)}
                        aria-label="Selecionar mensagem"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                  {showDateSep && (
                    <div className="flex items-center justify-center py-3">
                      <span className="rounded-lg bg-[color:var(--chat-header-bg)] px-3 py-1 text-[12px] font-medium text-muted-foreground shadow-sm">
                        {formatDateLabel(msg.created_at)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`group/msg flex max-w-[86%] items-start gap-1 sm:max-w-[72%] ${
                      isOutbound ? "ml-auto flex-row-reverse" : "flex-row"
                    } ${showBlockHeader ? "mt-2" : "mt-0.5"}`}
                  >
                    {!isOutbound && (
                      <div className="mt-0.5 size-8 shrink-0">
                        {showBlockHeader && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => handleOpenSenderContact(msg)}
                            className="size-8 overflow-hidden rounded-full p-0 text-[11px] font-semibold"
                            style={{ backgroundColor: senderColor.bg, color: senderColor.fg }}
                            aria-label="Abrir dados do contato"
                            title="Abrir dados do contato"
                          >
                            {senderAvatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={senderAvatarUrl}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              initialsFromName(senderDisplayName)
                            )}
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Reaction + context menu â€" visible on hover, hidden in bulk select */}
                    <div className={cn("flex items-center gap-0.5 transition-opacity self-end mb-1 shrink-0", bulkSelectMode ? "opacity-0 pointer-events-none" : "opacity-0 group-hover/msg:opacity-100")}>
                      {/* Quick emoji reactions */}
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
                      {/* Context menu */}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/10 transition-colors"
                          title="Mais opções"
                        >
                          <ChevronDown className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align={isOutbound ? "end" : "start"} className="min-w-[160px]">
                          {isOutbound && msg.status === "failed" && msg.text && (
                            <>
                              <DropdownMenuItem onClick={() => {
                                setChatInput(msg.text!);
                                toast.info("Texto restaurado para reenvio");
                              }}>
                                <RefreshCw className="size-4" />
                                Reenviar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem onClick={() => { setBulkSelectMode(true); setSelectedMsgIds(new Set([msg.id])); }}>
                            <Square className="size-4" />
                            Selecionar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setReplyTo(msg)}>
                            <CornerUpLeft className="size-4" />
                            Responder
                          </DropdownMenuItem>
                          {msg.text && (
                            <DropdownMenuItem onClick={() => {
                              navigator.clipboard.writeText(msg.text!); toast.success("Copiado!");
                            }}>
                              <Copy className="size-4" />
                              Copiar
                            </DropdownMenuItem>
                          )}
                          {msg.whatsapp_msg_id && (
                            <DropdownMenuItem onClick={() => setReactingMsgId(msg.id)}>
                              <Smile className="size-4" />
                              Reagir
                            </DropdownMenuItem>
                          )}
                          {msg.whatsapp_msg_id && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handlePinMessage(msg.id, msg.whatsapp_msg_id, !msg.is_pinned)}>
                                <Pin className="size-4" />
                                {msg.is_pinned ? "Desafixar" : "Fixar"}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteDialogMsg(msg)}
                          >
                            <Trash2 className="size-4" />
                            Apagar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Bubble column */}
                    <div className={`flex flex-col gap-0.5 ${isOutbound ? "items-end" : "items-start"}`}>
                      {/* Sender label above bubble */}
                      {showBlockHeader && isOutbound ? (
                        <p className="text-[11px] px-1" style={{ color: "var(--chat-timestamp)" }}>Você</p>
                      ) : showBlockHeader ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleOpenSenderContact(msg)}
                          className="h-auto max-w-[260px] justify-start gap-1 px-1 py-0 text-left text-[11px] font-semibold hover:underline"
                          style={{ color: senderColor.bg }}
                          title="Abrir dados do contato"
                        >
                          <span className="truncate">{senderDisplayName}</span>
                          {senderLead && (
                            <Badge variant="secondary" className="h-4 px-1 text-[9px] leading-none">
                              Lead
                            </Badge>
                          )}
                        </Button>
                      ) : null}
                      {showBlockHeader && !isOutbound && senderSecondary && senderSecondary !== senderDisplayName && (
                        <p className="max-w-[260px] truncate px-1 text-[10px] text-muted-foreground">
                          {senderSecondary}
                        </p>
                      )}

                      {/* Bubble */}
                      <div
                        className={cn(
                          "rounded-[7.5px] shadow-sm overflow-hidden",
                          isOutbound ? "rounded-br-sm" : "rounded-bl-sm",
                          isOutbound && msg.status === "failed" && "border border-destructive",
                        )}
                        style={
                          isOutbound && msg.status === "failed"
                            ? { background: "hsl(var(--destructive) / 0.12)", color: "var(--chat-bubble-out-text)" }
                            : isOutbound
                            ? { background: "var(--chat-bubble-out)", color: "var(--chat-bubble-out-text)" }
                            : { background: "var(--chat-bubble-in)", color: "var(--chat-bubble-in-text)" }
                        }
                      >
                        {repliedMessage && (
                          <div
                            className="mx-1.5 mt-1.5 rounded-md border-l-4 px-2 py-1.5 text-xs"
                            style={{
                              borderColor: "var(--chat-send-bg)",
                              background: "rgba(0,0,0,0.06)",
                            }}
                          >
                            <p className="truncate font-semibold text-[color:var(--chat-send-bg)]">
                              {getSenderLabel(repliedMessage)}
                            </p>
                            <p className="line-clamp-2 text-muted-foreground">
                              {getMessagePreview(repliedMessage)}
                            </p>
                          </div>
                        )}
                        {/* Media content — matches chat-window.tsx */}
                        {msg.media_url && msg.media_type === "sticker" && (
                          <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={msg.media_url} alt="Sticker" className="size-28 object-contain" />
                          </a>
                        )}
                        {msg.media_url && msg.media_type === "sticker" && (
                          <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={msg.media_url} alt="Sticker" className="size-28 object-contain" />
                          </a>
                        )}
                        {msg.media_url && msg.media_type === "image" && (
                          <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={msg.media_url} alt="" className="max-h-64 w-full rounded-t-[7.5px] object-cover mb-1" />
                          </a>
                        )}
                        {!msg.media_url && msg.media_type === "image" && (
                          <div className="flex items-center gap-2 px-2.5 pt-2 mb-1">
                            <Image className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Imagem</span>
                          </div>
                        )}
                        {msg.media_url && (msg.media_type === "audio" || msg.media_type === "ptt") && (
                          <AudioPlayer src={msg.media_url} isOutgoing={isOutbound} />
                        )}
                        {!msg.media_url && (msg.media_type === "audio" || msg.media_type === "ptt") && (
                          <div className="flex items-center gap-2 px-2.5 pt-2 mb-1">
                            <Mic className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Áudio</span>
                          </div>
                        )}
                        {msg.media_url && msg.media_type === "video" && (
                          <video controls className="max-h-64 w-full rounded-t-[7.5px] mb-1">
                            <source src={msg.media_url} />
                          </video>
                        )}
                        {!msg.media_url && msg.media_type === "video" && (
                          <div className="flex items-center gap-2 px-2.5 pt-2 mb-1">
                            <FileVideo className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Vídeo</span>
                          </div>
                        )}
                        {msg.media_url && msg.media_type === "document" && (
                          <a
                            href={msg.media_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mb-1 flex min-w-52 items-center gap-3 rounded-md border border-border/60 bg-background/60 p-3 text-foreground hover:bg-background/80"
                          >
                            <FileText className="size-8 shrink-0 text-primary" />
                            <span className="flex flex-col min-w-0">
                              <span className="truncate text-[13px] font-medium">Documento</span>
                              <span className="block text-[10px] text-muted-foreground">Abrir documento</span>
                            </span>
                          </a>
                        )}
                        {!msg.media_url && msg.media_type === "document" && (
                          <div className="flex items-center gap-2 px-2.5 pt-2 mb-1">
                            <File className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Documento</span>
                          </div>
                        )}
                        {/* Text / caption + timestamp */}
                        <div className={msg.text ? "px-2.5 py-1.5 text-[14.2px] leading-5" : "px-2.5 pb-1.5 pt-0 text-[14.2px] leading-5"}>
                          {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
                          <span
                            className="text-[10px] float-right ml-2 mt-1 inline-flex items-center gap-0.5"
                            style={{ color: "var(--chat-timestamp)" }}
                          >
                            {formatTime(msg.created_at)}
                            {isOutbound && <GroupMsgStatusIcon status={msg.status ?? "sent"} />}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>{/* flex-1 min-w-0 */}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bulk selection action bar */}
      {bulkSelectMode && (
        <div className="shrink-0 border-t border-[color:var(--chat-sidebar-divider)] px-4 py-3 flex items-center justify-between gap-3" style={{ background: "var(--chat-input-bar-bg)" }}>
          <span className="text-sm text-muted-foreground">
            {selectedMsgIds.size === 0
              ? "Nenhuma selecionada"
              : `${selectedMsgIds.size} mensagem${selectedMsgIds.size > 1 ? "s" : ""} selecionada${selectedMsgIds.size > 1 ? "s" : ""}`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={exitBulkSelect}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedMsgIds.size === 0 || deletingBulk}
              onClick={handleBulkDelete}
            >
              {deletingBulk ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Apagar ({selectedMsgIds.size})
            </Button>
          </div>
        </div>
      )}

      {/* Input bar â€" matching MessageInput style */}
      {!bulkSelectMode && (
      <div
        className="shrink-0 border-t border-[color:var(--chat-sidebar-divider)] px-3 py-2"
        style={{ background: "var(--chat-input-bar-bg)" }}
      >
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-[color:var(--chat-send-bg)] bg-muted/50 px-3 py-2">
            <CornerUpLeft className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-[color:var(--chat-send-bg)]">
                {getSenderLabel(replyTo)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {getMessagePreview(replyTo)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setReplyTo(null)}
              aria-label="Cancelar resposta"
              title="Cancelar resposta"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}

        {aiOpen && (
          <div className="mb-2 rounded-xl border bg-popover p-3 shadow-lg">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Assistente IA</p>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setAiOpen(false)} className="size-6" title="Fechar">
                  <X className="size-3" />
                </Button>
              </div>
              <Textarea
                ref={aiTextareaRef}
                name="group-ai-prompt"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Ex: Responder confirmando a reunião..."
                rows={2}
                className="min-h-[64px] resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerateAiDraft();
                  }
                }}
              />
              <Button size="sm" onClick={handleGenerateAiDraft} disabled={aiLoading || !aiPrompt.trim()} className="w-full">
                {aiLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {aiLoading ? "Gerando..." : "Gerar sugestão"}
              </Button>
              {aiDraft && (
                <div className="space-y-2">
                  <div className="max-h-36 overflow-y-auto rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">
                    {aiDraft}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={handleGenerateAiDraft}
                      disabled={aiLoading}
                    >
                      <RefreshCw className="size-3.5" />
                      Regenerar
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setChatInput(aiDraft);
                        setAiOpen(false);
                        setAiDraft("");
                        toast.success("Sugestão adicionada");
                      }}
                    >
                      <Copy className="size-3.5" />
                      Usar no campo
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden" onChange={handleFileSelect} />
        <input ref={imageInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileSelect} />
        <input ref={audioFileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />

        {/* Attachment preview bar */}
        {attachedFile && (
          <div
            className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-[color:var(--chat-sidebar-divider)]"
            style={{ background: "var(--chat-input-bg)" }}
          >
            {attachedPreview ? (
              <img src={attachedPreview} alt="preview" className="h-14 w-14 rounded object-cover border shrink-0" />
            ) : (
              <div className="h-14 w-14 rounded border bg-background flex items-center justify-center shrink-0">
                {attachedMediaType === "video" ? (
                  <FileVideo className="size-5 text-muted-foreground" />
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
            <Button variant="ghost" size="icon-sm" className="size-6 shrink-0" onClick={clearAttachment}>
              <X className="size-3" />
            </Button>
          </div>
        )}

        <div className="flex items-end gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={sendingMedia || isRecording}
                className="size-10 shrink-0 rounded-full text-muted-foreground hover:bg-transparent hover:text-[color:var(--chat-header-fg)]"
                aria-label="Mais op\u00E7\u00F5es"
              >
                {sendingMedia ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <Image className="size-4 text-primary" />
                Foto / {"\u0056\u00ED"}deo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => audioFileInputRef.current?.click()}>
                <Mic className="size-4 text-muted-foreground" />
                Enviar {"\u00E1"}udio
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="size-4 text-muted-foreground" />
                Documento
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAiOpen(true)}>
                <Sparkles className="size-4 text-primary" />
                Gerar com IA
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 rounded-full hover:bg-transparent"
                style={{ color: "var(--chat-header-fg)" }}
                title="Emoji"
                aria-label="Emoji"
                disabled={isRecording || sendingMessage || sendingMedia}
              >
                <Smile className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto p-0 border-0">
              <EmojiPicker
                onEmojiClick={(d) => {
                  setChatInput((prev) => prev + d.emoji);
                  setEmojiOpen(false);
                }}
                width={320}
                height={400}
                searchPlaceholder="Buscar emoji..."
                previewConfig={{ showPreview: false }}
              />
            </PopoverContent>
          </Popover>

          {/* Schedule message */}
          <Popover open={schedulePopoverOpen} onOpenChange={(o) => { setSchedulePopoverOpen(o); if (o) handleLoadScheduled(); }}>
            <PopoverTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 rounded-full hover:bg-transparent"
                style={{ color: "var(--chat-header-fg)" }}
                title="Agendar mensagem"
                aria-label="Agendar mensagem"
                disabled={isRecording || sendingMessage || sendingMedia}
              >
                <Clock className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-80 p-4 flex flex-col gap-3">
              <div className="font-medium text-sm">Agendar mensagem</div>
              <Textarea
                name="schedule-group-message"
                placeholder="Texto da mensagem..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="min-h-[80px] text-sm resize-none"
              />
              <Input
                type="datetime-local"
                name="schedule-group-at"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              <Button
                size="sm"
                onClick={handleScheduleMessage}
                disabled={!chatInput.trim() || !scheduleAt || schedulingMessage}
                className="self-end"
              >
                {schedulingMessage ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Clock className="size-3.5 mr-1" />}
                Agendar
              </Button>
              {scheduledList.length > 0 && (
                <div className="border-t pt-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
                  <div className="text-xs font-medium text-muted-foreground">Pendentes</div>
                  {scheduledList.map((s) => (
                    <div key={s.id} className="flex items-start justify-between gap-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{s.content}</div>
                        <div className="text-muted-foreground">{formatFullDateTime(s.scheduled_at)}</div>
                        {s.status === "error" && <div className="text-destructive">{s.error_message}</div>}
                      </div>
                      <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => handleCancelScheduled(s.id)}>
                        <X className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {loadingScheduled && <div className="text-xs text-muted-foreground text-center">Carregando...</div>}
            </PopoverContent>
          </Popover>

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
            <textarea
              ref={textareaRef}
              value={chatInput}
              onChange={(e) => {
                setChatInput(e.target.value);
                adjustHeight();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
              }}
              placeholder={attachedFile ? "Legenda (opcional)..." : "Digite uma mensagem..."}
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-lg px-4 py-[11px] text-[15px] leading-5 outline-none placeholder:text-[color:var(--chat-timestamp)] focus:ring-1 focus:ring-[color:var(--chat-send-bg)]"
              style={{ background: "var(--chat-input-field-bg)", color: "var(--chat-header-fg)", border: "none" }}
              rows={1}
              disabled={sendingMessage || sendingMedia}
            />
          )}

          {isRecording ? (
            <Button
              size="icon"
              onClick={handleStopRecording}
              className="size-10 shrink-0 rounded-full hover:opacity-90"
              style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
            >
              <Square className="size-4 fill-current" />
            </Button>
          ) : (chatInput.trim() || attachedFile) ? (
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={sendingMessage || sendingMedia}
              className="size-10 shrink-0 rounded-full hover:opacity-90 disabled:opacity-70"
              style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
            >
              {(sendingMessage || sendingMedia) ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
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
      )}{/* end !bulkSelectMode */}

      {/* Members / contact panel â€" Sheet overlay, não empurra o layout */}
      <Sheet open={membersOpen} onOpenChange={(o) => { if (!o) { setMembersOpen(false); setSelectedMember(null); setSelectedContact(null); } }}>
        <SheetContent side="right" showCloseButton={false} className="w-full max-w-[440px] p-0 overflow-hidden">
          {selectedContact ? (
            <LeadContactPanel
              lead={selectedContact}
              onClose={() => setSelectedContact(null)}
            />
          ) : selectedMember ? (
            <LeadContactPanel
              lead={contactFromGroupMember(selectedMember)}
              onClose={() => setSelectedMember(null)}
            />
          ) : (
            <div className="flex h-full flex-col overflow-y-auto">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Participantes do grupo
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={backfillLoading}
                    onClick={async () => {
                      setBackfillLoading(true);
                      try {
                        const res = await backfillGroupMembers(group.id);
                        if (res.error) {
                          toast.error(res.error);
                        } else {
                          toast.success(`${res.linked} lead(s) identificado(s) de ${res.processed} participante(s)`);
                          await handleOpenMembers();
                        }
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Erro ao identificar membros");
                      } finally {
                        setBackfillLoading(false);
                      }
                    }}
                    title="Identificar leads pelos historico de mensagens"
                  >
                    {backfillLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => setMembersOpen(false)} aria-label="Fechar">
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>
              {membersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : groupMembers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
                  <UserCircle className="size-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nenhum contato do grupo encontrado</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={backfillLoading}
                    onClick={async () => {
                      setBackfillLoading(true);
                      try {
                        const res = await backfillGroupMembers(group.id);
                        if (res.error) {
                          toast.error(res.error);
                        } else {
                          toast.success(`${res.linked} lead(s) identificado(s) de ${res.processed} participante(s)`);
                          await handleOpenMembers();
                        }
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Erro ao identificar membros");
                      } finally {
                        setBackfillLoading(false);
                      }
                    }}
                  >
                    {backfillLoading ? (
                      <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    ) : (
                      <RefreshCw className="size-3.5 mr-1.5" />
                    )}
                    Identificar pelo historico
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border/30">
                  {groupMembers.map((member) => {
                    const contact = contactFromGroupMember(member);
                    const displayName = contact.name || contact.phone || "Sem nome";
                    const displayPhone = contact.phone || member.phone || "";
                    const color = senderColorForKey(member.lead_id ?? member.phone ?? member.name ?? member.membership_id);

                    return (
                      <Button
                        key={member.membership_id}
                        type="button"
                        variant="ghost"
                        onClick={() => setSelectedMember(member)}
                        className="h-auto justify-start gap-3 rounded-none px-4 py-3 text-left"
                        title="Abrir dados do contato"
                      >
                        <Avatar size="sm" className="shrink-0">
                          {safeAvatarUrl(contact.avatar_url) ? (
                            <AvatarImage src={safeAvatarUrl(contact.avatar_url)!} alt={displayName} />
                          ) : null}
                          <AvatarFallback style={{ backgroundColor: color.bg, color: color.fg }}>
                            {displayName.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-sm font-medium">{displayName}</p>
                            {member.lead ? (
                              <Badge variant="secondary" className="shrink-0">
                                Lead
                              </Badge>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{displayPhone}</p>
                        </div>
                        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Group details sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" showCloseButton={false} className="w-full max-w-[480px] overflow-y-auto p-0">
          <div className="flex min-h-full flex-col bg-background">
            <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background px-4">
              <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(false)} aria-label="Fechar">
                <X className="size-5" />
              </Button>
              <p className="text-base font-medium">Dados do grupo</p>
            </div>

            <div className="flex flex-col items-center px-6 py-7 text-center">
              <Avatar className="size-28">
                {safeAvatarUrl(group.image_url) ? <AvatarImage src={safeAvatarUrl(group.image_url)!} alt={group.name} /> : null}
                <AvatarFallback className={hashGroupColor(group.name)}>
                  <Users className="size-12 text-white" />
                </AvatarFallback>
              </Avatar>

              <div className="mt-5 flex w-full items-center justify-center gap-2">
                <Input
                  name="group-details-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="max-w-[300px] border-0 bg-transparent text-center text-xl font-medium shadow-none focus-visible:ring-1"
                />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Grupo · <span className="font-semibold text-success">{group.participant_count} membros</span>
              </p>

              <div className="mt-5 flex items-center gap-4">
                <Button variant="secondary" className="h-auto flex-col rounded-full px-5 py-3" onClick={() => setInviteOpen(true)}>
                  <UserPlus className="size-5" />
                  <span className="text-xs font-normal">Adicionar</span>
                </Button>
                <Button
                  variant="secondary"
                  className="h-auto flex-col rounded-full px-5 py-3"
                  onClick={() => {
                    setSettingsOpen(false);
                    void handleOpenMembers();
                  }}
                >
                  <Search className="size-5" />
                  <span className="text-xs font-normal">Pesquisar</span>
                </Button>
              </div>
            </div>

            <div className="border-t px-5 py-4">
              <Textarea
                name="group-details-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Adicionar descricao ao grupo"
                className="min-h-16 resize-none border-0 px-0 shadow-none focus-visible:ring-0"
              />
            </div>

            <div className="border-t px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Image className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium">Midia, links e docs</span>
                </div>
                <span className="text-sm text-muted-foreground">{mediaPreviewMessages.length}</span>
              </div>
              {mediaPreviewMessages.length > 0 && (
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {mediaPreviewMessages.map((message) => (
                    <div key={message.id} className="aspect-square overflow-hidden rounded-md bg-muted">
                      {message.media_type?.startsWith("image") || message.media_type === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={message.media_url ?? ""} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full items-center justify-center">
                          <File className="size-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t py-2">
              <div className="flex items-center gap-4 px-5 py-3">
                <Heart className="size-5 text-muted-foreground" />
                <span className="text-sm">Adicionar aos favoritos</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="flex items-center gap-4">
                  <Bell className="size-5 text-muted-foreground" />
                  <span className="text-sm">Silenciar notificacoes</span>
                </div>
                <Switch checked={false} disabled />
              </div>
              <div className="mx-3 rounded-lg bg-muted/60 px-2 py-3">
                <div className="flex items-start gap-4 px-3">
                  <Lock className="mt-0.5 size-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm">Criptografia</p>
                    <p className="text-xs text-muted-foreground">As mensagens sao protegidas com criptografia de ponta a ponta.</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 px-5 py-3">
                <RefreshCw className="size-5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm">Mensagens temporarias</p>
                  <Select value={editEphemeral} onValueChange={(v) => setEditEphemeral((v ?? "off") as typeof editEphemeral)}>
                    <SelectTrigger className="mt-1 h-8 max-w-[180px]">
                      <SelectValue>
                        {{ off: "Desativadas", "1d": "1 dia", "7d": "7 dias", "90d": "90 dias" }[editEphemeral]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Desativadas</SelectItem>
                      <SelectItem value="1d">1 dia</SelectItem>
                      <SelectItem value="7d">7 dias</SelectItem>
                      <SelectItem value="90d">90 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-4 px-5 py-3">
                <ShieldCheck className="size-5 text-muted-foreground" />
                <div>
                  <p className="text-sm">Privacidade avancada da conversa</p>
                  <p className="text-xs text-muted-foreground">Desativada</p>
                </div>
              </div>
            </div>

            <div className="border-t px-5 py-4">
              <div className="mb-3 flex items-center gap-4">
                <Settings className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">Permissoes do grupo</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm">Modo anuncio</p>
                    <p className="text-xs text-muted-foreground">So admins enviam mensagens</p>
                  </div>
                  <Switch checked={editAnnounce} onCheckedChange={setEditAnnounce} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm">Editar dados do grupo</p>
                    <p className="text-xs text-muted-foreground">Restrito a admins quando ativado</p>
                  </div>
                  <Switch checked={editLocked} onCheckedChange={setEditLocked} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm">Aprovar novos membros</p>
                    <p className="text-xs text-muted-foreground">Admin aprova entradas pelo link</p>
                  </div>
                  <Switch checked={editJoinApproval} onCheckedChange={setEditJoinApproval} />
                </div>
                <Select value={editMemberAddMode} onValueChange={(v) => setEditMemberAddMode((v ?? "all_member_add") as typeof editMemberAddMode)}>
                  <SelectTrigger>
                    <SelectValue>
                      {{ all_member_add: "Todos podem adicionar membros", admin_add: "Somente admins adicionam membros" }[editMemberAddMode]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_member_add">Todos podem adicionar membros</SelectItem>
                    <SelectItem value="admin_add">Somente admins adicionam membros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">{groupMembers.length || group.participant_count} membros</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setSettingsOpen(false);
                    void handleOpenMembers();
                  }}
                  title="Pesquisar membros"
                >
                  <Search className="size-4" />
                </Button>
              </div>
              <div className="space-y-1">
                <Button variant="ghost" className="h-auto w-full justify-start gap-4 px-0 py-3" onClick={() => setInviteOpen(true)}>
                  <span className="flex size-10 items-center justify-center rounded-full bg-success text-success-foreground">
                    <UserPlus className="size-5" />
                  </span>
                  <span>Adicionar membro</span>
                </Button>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start gap-4 px-0 py-3"
                  onClick={async () => {
                    const link = inviteLink || await getInviteLink(group.id);
                    setInviteLink(link);
                    await navigator.clipboard.writeText(link);
                    toast.success("Link de convite copiado");
                  }}
                >
                  <span className="flex size-10 items-center justify-center rounded-full bg-success text-success-foreground">
                    <Link2 className="size-5" />
                  </span>
                  <span>Convidar via link</span>
                </Button>
                {membersLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  groupMembers.slice(0, 8).map((member) => {
                    const contact = contactFromGroupMember(member);
                    const displayName = contact.name || contact.phone || "Sem nome";
                    const displayPhone = contact.phone || member.phone || "";
                    const color = senderColorForKey(member.lead_id ?? member.phone ?? member.name ?? member.membership_id);

                    return (
                      <Button
                        key={member.membership_id}
                        variant="ghost"
                        className="h-auto w-full justify-start gap-3 px-0 py-3 text-left"
                        onClick={() => {
                          setSelectedMember(member);
                          setSettingsOpen(false);
                          setMembersOpen(true);
                        }}
                      >
                        <Avatar size="default" className="shrink-0">
                          {safeAvatarUrl(contact.avatar_url) ? <AvatarImage src={safeAvatarUrl(contact.avatar_url)!} alt={displayName} /> : null}
                          <AvatarFallback style={{ backgroundColor: color.bg, color: color.fg }}>
                            {displayName.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{displayName}</p>
                            {member.lead ? <Badge variant="secondary">Lead</Badge> : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{displayPhone}</p>
                        </div>
                      </Button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="border-t px-5 py-4">
              <Button onClick={handleSaveSettings} disabled={saving || !editName.trim()} className="w-full">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? "Salvando..." : "Salvar dados do grupo"}
              </Button>
            </div>

            <div className="px-5 pb-6">
              <div className="space-y-1 rounded-lg bg-muted/40 py-2">
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start gap-4 px-4 py-3 text-destructive"
                  onClick={handleLeaveGroup}
                  disabled={leavingGroup}
                >
                  {leavingGroup ? <Loader2 className="size-5 animate-spin" /> : <LogOut className="size-5" />}
                  {leavingGroup ? "Saindo..." : "Sair do grupo"}
                </Button>
                <Button variant="ghost" className="h-auto w-full justify-start gap-4 px-4 py-3 text-destructive" onClick={() => onDelete(group.id)}>
                  <Trash2 className="size-5" />
                  Remover grupo do CRM
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Grupo criado em {formatFullDateTime(group.created_at)}
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete message confirmation */}
      <Dialog open={!!deleteDialogMsg} onOpenChange={(open) => { if (!open) setDeleteDialogMsg(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Deseja apagar a mensagem?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                if (deleteDialogMsg) handleDeleteMessage(deleteDialogMsg);
                setDeleteDialogMsg(null);
              }}
            >
              <Trash2 className="size-4 mr-2" />
              Apagar para todos
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setDeleteDialogMsg(null)}
            >
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar Convite</DialogTitle>
            <DialogDescription>O lead receberá o link de convite do grupo via WhatsApp.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Lead</Label>
            <Select value={selectedLeadId} onValueChange={(v) => setSelectedLeadId(v ?? "")}>
              <SelectTrigger>
                <SelectValue>
                  {leads.find((l) => l.id === selectedLeadId)?.name ?? "Selecione um lead..."}
                </SelectValue>
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
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleSendInvite} disabled={sendingInvite || !selectedLeadId}>
              {sendingInvite ? "Enviando..." : "Enviar Convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// â"€â"€â"€ Lead type for invite â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

interface Lead {
  id: string;
  name: string;
  phone: string | null;
}

// â"€â"€â"€ Campaign Manager Sheet â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function CampaignManagerSheet({
  open,
  onOpenChange,
  campaigns,
  groups,
  orgSlug,
  onCampaignsChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaigns: GroupCampaign[];
  groups: Group[];
  orgSlug: string;
  onCampaignsChange: (campaigns: GroupCampaign[]) => void;
}) {
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newSlug, setNewSlug] = React.useState("");
  const [newMode, setNewMode] = React.useState<"balanced" | "sequential">("balanced");
  const [saving, setSaving] = React.useState(false);

  function autoSlug(name: string) {
    return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  async function handleCreate() {
    if (!newName.trim() || !newSlug.trim()) return;
    setSaving(true);
    try {
      const c = await createGroupCampaign({ name: newName.trim(), slug: newSlug, distribution_mode: newMode });
      onCampaignsChange([c, ...campaigns]);
      setCreating(false);
      setNewName("");
      setNewSlug("");
      toast.success("Campanha criada");
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar campanha");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(campaign: GroupCampaign) {
    try {
      await updateGroupCampaign(campaign.id, { is_active: !campaign.is_active });
      onCampaignsChange(campaigns.map((c) => c.id === campaign.id ? { ...c, is_active: !c.is_active } : c));
    } catch (err: any) {
      toast.error(err.message || "Erro");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteGroupCampaign(id);
      onCampaignsChange(campaigns.filter((c) => c.id !== id));
      toast.success("Campanha removida");
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
  }

  async function handleLinkGroup(groupId: string, campaignId: string | null) {
    try {
      await linkGroupToCampaign(groupId, campaignId);
      toast.success(campaignId ? "Grupo vinculado" : "Vínculo removido");
    } catch (err: any) {
      toast.error(err.message || "Erro");
    }
  }

  // useState "" garante que servidor e cliente renderizam igual no primeiro pass,
  // evitando hydration mismatch (React error #418).
  const [baseUrl, setBaseUrl] = React.useState("");
  React.useEffect(() => { setBaseUrl(window.location.origin); }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Campanhas / Link Inteligente</SheetTitle>
          <SheetDescription>
            Crie uma campanha com link único que distribui leads entre grupos automaticamente.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          {/* Create campaign */}
          {!creating ? (
            <Button variant="outline" onClick={() => setCreating(true)} className="w-full">
              <Plus className="size-4" /> Nova Campanha
            </Button>
          ) : (
            <div className="rounded-xl border p-4 space-y-3">
              <p className="text-sm font-semibold">Nova Campanha</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Nome</Label>
                <Input
                  name="campaign-name"
                  placeholder="Ex: Lançamento ICBID"
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setNewSlug(autoSlug(e.target.value)); }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Slug da URL</Label>
                <Input
                  name="campaign-slug"
                  placeholder="Ex: icbid"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  className="font-mono text-xs"
                />
                {newSlug && orgSlug && (
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {baseUrl}/g/{orgSlug}/{newSlug}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Distribuição</Label>
                <Select value={newMode} onValueChange={(v) => setNewMode(v as "balanced" | "sequential")}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue>{newMode === "balanced" ? "Balanceado" : "Sequencial"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="balanced">Balanceado — distribui igualmente</SelectItem>
                    <SelectItem value="sequential">Sequencial — enche um por vez</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={handleCreate} disabled={saving || !newName.trim() || !newSlug.trim()} size="sm">
                  {saving ? <Loader2 className="size-3 animate-spin" /> : "Criar"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {/* Campaign list */}
          {campaigns.length === 0 && !creating && (
            <EmptyState variant="subtle" icon={<Zap />} title="Nenhuma campanha" description="Crie uma campanha para gerar links inteligentes" />
          )}

          {campaigns.map((campaign) => {
            const linkedGroups = groups.filter((g) => g.campaign_id === campaign.id);
            const smartLink = `${baseUrl}/g/${orgSlug}/${campaign.slug}`;
            return (
              <div key={campaign.id} className="rounded-xl border p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{campaign.name}</p>
                      <Badge variant={campaign.is_active ? "default" : "secondary"} className="text-[10px]">
                        {campaign.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {campaign.distribution_mode === "balanced" ? "Balanceado" : "Sequencial"}
                      {" \u00B7 "}{linkedGroups.length} grupos vinculados
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleToggleActive(campaign)}>
                        {campaign.is_active ? "Desativar" : "Ativar"}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => handleDelete(campaign.id)}>
                        <Trash2 className="size-4" /> Remover
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Smart link */}
                <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                  <Link2 className="size-3.5 text-muted-foreground shrink-0" />
                  <p className="text-[11px] font-mono text-muted-foreground truncate flex-1">{smartLink}</p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 shrink-0"
                    onClick={() => { navigator.clipboard.writeText(smartLink); toast.success("Link copiado!"); }}
                  >
                    <Copy className="size-3" />
                  </Button>
                  <a href={smartLink} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="icon-sm" className="size-6 shrink-0">
                      <ExternalLink className="size-3" />
                    </Button>
                  </a>
                </div>

                {/* Link groups */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Grupos vinculados</p>
                  {groups.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`size-2 rounded-full shrink-0 ${g.campaign_id === campaign.id ? "bg-primary" : "bg-muted"}`} />
                        <p className="text-xs truncate">{g.name}</p>
                        <span className="text-[10px] text-muted-foreground shrink-0">{g.participant_count}/{g.max_participants}</span>
                      </div>
                      <Switch
                        checked={g.campaign_id === campaign.id}
                        onCheckedChange={(checked) => handleLinkGroup(g.id, checked ? campaign.id : null)}
                      />
                    </div>
                  ))}
                  {groups.length === 0 && (
                    <p className="text-xs text-muted-foreground">Nenhum grupo disponível</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// â"€â"€â"€ Main page component â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export function GroupsClient({ initialGroups }: { initialGroups: Group[] }) {
  const [groups, setGroups] = React.useState<Group[]>(initialGroups);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [unreadCounts, setUnreadCounts] = React.useState<Record<string, number>>({});
  // Captura lastSeen durante o render (antes de qualquer effect) para evitar
  // race condition com useGroupsUnreadCount (Sidebar) que roda antes no DOM.
  const [initialLastSeen] = React.useState<string>(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem("groups_last_seen_at") ?? new Date(0).toISOString())
      : new Date(0).toISOString()
  );
  // Escreve timestamp no unmount — indica que o user "viu" até este momento.
  React.useEffect(() => {
    return () => {
      localStorage.setItem("groups_last_seen_at", new Date().toISOString());
    };
  }, []);
  // Inicializa contagens nao-lidas do DB no mount.
  React.useEffect(() => {
    const groupIds = initialGroups.map((g) => g.id);
    if (groupIds.length === 0) return;
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("group_messages")
      .select("group_id")
      .in("group_id", groupIds)
      .eq("direction", "inbound")
      .eq("is_deleted", false)
      .gt("created_at", initialLastSeen)
      .then(({ data }: { data: Array<{ group_id: string }> | null }) => {
        if (!data || data.length === 0) return;
        const counts: Record<string, number> = {};
        for (const msg of data) {
          counts[msg.group_id] = (counts[msg.group_id] ?? 0) + 1;
        }
        setUnreadCounts(counts);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLastSeen]);
  const [lastMessages, setLastMessages] = React.useState<Record<string, GroupLastMsg>>(() => {
    const init: Record<string, GroupLastMsg> = {};
    for (const g of initialGroups) {
      if (g.last_message_at) {
        init[g.id] = {
          text: g.last_message_text,
          sender: g.last_message_sender,
          direction: g.last_message_direction ?? "inbound",
          at: g.last_message_at,
        };
      }
    }
    return init;
  });

  // Ref para o selectedId atual dentro do callback do Realtime (evita closure stale)
  const selectedIdRef = React.useRef<string | null>(null);
  React.useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  // Ref para groups atual dentro do callback
  const groupsRef = React.useRef<Group[]>(initialGroups);
  React.useEffect(() => { groupsRef.current = groups; }, [groups]);

  // Sync
  const [syncing, setSyncing] = React.useState(false);

  // Search / filter
  const [search, setSearch] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("todos");

  const selectedGroup = groups.find((g) => g.id === selectedId) ?? null;

  // Load leads for invite selector
  React.useEffect(() => {
    const supabase = createClient();
    supabase
      .from("leads")
      .select("id, name, phone")
      .not("phone", "is", null)
      .order("name")
      .limit(200)
      .then(({ data }) => setLeads((data || []) as Lead[]));
  }, []);

  // Global Realtime subscription â€" notifica mensagens de grupos não selecionados
  // e mantém contagem de não lidas no painel lateral.
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("groups_global_messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages" },
        (payload: { new: { group_id: string; direction: string; text: string | null; sender_name: string | null; created_at: string } }) => {
          const { group_id, direction, text, sender_name, created_at } = payload.new;
          if (direction !== "inbound") return;

          // Atualiza preview da última mensagem no painel lateral
          setLastMessages((prev) => ({
            ...prev,
            [group_id]: { text, sender: sender_name, direction, at: created_at },
          }));

          // Só notifica/incrementa unread para grupos fora de foco
          if (group_id === selectedIdRef.current) return;

          setUnreadCounts((prev) => ({ ...prev, [group_id]: (prev[group_id] ?? 0) + 1 }));

          const grp = groupsRef.current.find((g) => g.id === group_id);
          if (grp) {
            const sender = sender_name || "Participante";
            const preview = text
              ? text.length > 60 ? text.slice(0, 60) + "…" : text
              : "Nova mensagem";
            toast.message(grp.name, { description: `${sender}: ${preview}` });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []); // monta uma vez â€" usa refs para selectedId e groups

  function handleSelectGroup(id: string) {
    setSelectedId(id);
    // Zera não lidas ao abrir o grupo
    setUnreadCounts((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await syncGroups();
      toast.success(`${result.synced} grupos sincronizados`);
      window.location.reload();
    } catch (err: any) {
      toast.error(err.message || "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  function handleDelete(id: string) {
    deleteGroup(id)
      .then(() => {
        setGroups((prev) => prev.filter((g) => g.id !== id));
        if (selectedId === id) setSelectedId(null);
        toast.success("Grupo removido");
      })
      .catch((err: any) => toast.error(err.message || "Erro ao remover"));
  }

  function handleLeave(id: string) {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-[color:var(--chat-bg)]">
      {/* Left panel */}
      <div
        className={
          selectedId
            ? "hidden h-full shrink-0 overflow-hidden border-r border-[color:var(--chat-sidebar-divider)] md:flex md:w-[340px] md:flex-col xl:w-[380px] bg-background"
            : "h-full w-full shrink-0 overflow-hidden border-r border-[color:var(--chat-sidebar-divider)] md:flex md:w-[340px] md:flex-col xl:w-[380px] bg-background"
        }
      >
        <GroupListPanel
          groups={groups}
          selectedId={selectedId}
          onSelect={handleSelectGroup}
          onSync={handleSync}
          syncing={syncing}
          search={search}
          onSearch={setSearch}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
          unreadCounts={unreadCounts}
          lastMessages={lastMessages}
        />
      </div>

      {/* Right panel */}
      <div
        className={
          selectedId
            ? "flex-1 h-full overflow-hidden flex flex-col"
            : "hidden flex-1 h-full overflow-hidden md:flex md:flex-col"
        }
      >
        {selectedGroup ? (
          <GroupChatPanel
            group={selectedGroup}
            leads={leads}
            onBack={() => setSelectedId(null)}
            onDelete={handleDelete}
            onLeave={handleLeave}
          />
        ) : (
          <GroupEmptyState />
        )}
      </div>

    </div>
  );
}
