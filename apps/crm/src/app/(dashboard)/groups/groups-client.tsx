"use client";

import * as React from "react";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  ExternalLink,
  File,
  FileVideo,
  Image,
  Loader2,
  LogOut,
  Megaphone,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Trash2,
  Users,
  UserCircle,
  Link2,
  Save,
  X,
  CornerUpLeft,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@persia/ui/avatar";
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
import {
  createGroup,
  syncGroups,
  deleteGroup,
  sendMessageToGroup,
  sendMediaToGroup,
  deleteGroupMessage,
  reactToGroupMessage,
  getInviteLink,
  resetInviteLink,
  leaveGroup,
  updateGroup,
  sendInviteToLead,
  getGroupCampaigns,
  createGroupCampaign,
  updateGroupCampaign,
  deleteGroupCampaign,
  linkGroupToCampaign,
  setGroupCapacity,
  getGroupMessages,
  getGroupLeadMembers,
  backfillGroupMembers,
  generateGroupMessageDraft,
  type GroupCampaign,
  type GroupLeadMember,
} from "@/actions/groups";
import { LeadContactPanel } from "@/components/chat/lead-contact-panel";
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
  sender_lead?: GroupMessageSenderLead | null;
}

const QUICK_REACTIONS = ["ðŸ‘", "â¤ï¸", "ðŸ˜‚", "ðŸ˜®", "ðŸ˜¢", "ðŸ™", "ðŸ”¥", "ðŸ‘"];

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

  if (leadIds.length === 0 && phones.length === 0) return rows;

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

  return rows.map((row) => ({
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
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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

// â"€â"€â"€ Left panel: group list â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function GroupListPanel({
  groups,
  selectedId,
  onSelect,
  onCreateOpen,
  onSync,
  syncing,
  onCampaignOpen,
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
  onCreateOpen: () => void;
  onSync: () => void;
  syncing: boolean;
  onCampaignOpen: () => void;
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
          <Button variant="ghost" size="icon-sm" onClick={onCampaignOpen} title="Campanhas">
            <Zap className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onSync} disabled={syncing} title="Sincronizar">
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
          <Button size="icon-sm" onClick={onCreateOpen} title="Criar grupo">
            <Plus className="size-4" />
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
                      {group.image_url ? (
                        <AvatarImage src={group.image_url} alt={group.name} />
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
                      {group.campaign_id && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px] text-primary">
                          <Link2 className="size-2.5 mr-0.5" />
                          Campanha
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
  const [reactingMsgId, setReactingMsgId] = React.useState<string | null>(null);
  const [replyTo, setReplyTo] = React.useState<GroupMessage | null>(null);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiPrompt, setAiPrompt] = React.useState("");
  const [aiDraft, setAiDraft] = React.useState("");
  const [aiLoading, setAiLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  // Settings sheet state
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [editName, setEditName] = React.useState(group.name);
  const [editDescription, setEditDescription] = React.useState(group.description || "");
  const [editAnnounce, setEditAnnounce] = React.useState(group.is_announce);
  const [editCategory, setEditCategory] = React.useState(group.category);
  const [saving, setSaving] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState(group.invite_link || "");
  const [resettingLink, setResettingLink] = React.useState(false);
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
    const supabase = createClient();
    getGroupMessages(group.id)
      .then((data) => {
        setMessages(data as GroupMessage[]);
        setLoadingMsgs(false);
      })
      .catch(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("group_messages")
      .select("id, direction, text, sender_name, sender_jid, sender_phone, sender_lead_id, sender_membership_id, sender_identity_kind, sender_avatar_url, created_at, whatsapp_msg_id, media_url, media_type, reply_to_whatsapp_msg_id")
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
          void enrichGroupMessagesWithLeads(supabase, group.id, [payload.new]).then(([message]) => {
            if (!message) return;
            setMessages((prev) => {
              if (prev.some((m) => m.id === message.id)) return prev;
              return [...prev, message];
            });
          });
          // NÃ£o dispara toast aqui â€" o grupo estÃ¡ aberto e o usuÃ¡rio vÃª a mensagem
          // em tempo real. O toast para grupos nÃ£o selecionados Ã© gerenciado pelo
          // GlobalRealtimeSubscription em GroupsClient.
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "group_messages", filter: `group_id=eq.${group.id}` },
        (payload: { new: GroupMessage }) => {
          void enrichGroupMessagesWithLeads(supabase, group.id, [payload.new]).then(([message]) => {
            if (!message) return;
            setMessages((prev) =>
              prev.map((existing) => existing.id === message.id ? message : existing),
            );
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [group.id]);

  // Scroll to bottom on new messages
  React.useEffect(() => {
    if (!loadingMsgs) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loadingMsgs]);

  async function handleSendMessage() {
    const text = chatInput.trim();
    if (!text) return;
    setSendingMessage(true);
    setChatInput("");
    const replyingTo = replyTo;
    setReplyTo(null);
    try {
      await sendMessageToGroup(group.id, text, replyingTo?.whatsapp_msg_id ?? null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
      setChatInput(text);
      setReplyTo(replyingTo);
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    let mediaType: "image" | "video" | "audio" | "document" = "document";
    if (file.type.startsWith("image/")) mediaType = "image";
    else if (file.type.startsWith("video/")) mediaType = "video";
    else if (file.type.startsWith("audio/")) mediaType = "audio";

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string;
      if (!base64) return;
      setSendingMedia(true);
      const replyingTo = replyTo;
      setReplyTo(null);
      try {
        await sendMediaToGroup(group.id, base64, mediaType, undefined, file.name, replyingTo?.whatsapp_msg_id ?? null);
        toast.success("MÃ­dia enviada");
      } catch (err: any) {
        toast.error(err.message || "Erro ao enviar mÃ­dia");
        setReplyTo(replyingTo);
      } finally {
        setSendingMedia(false);
      }
    };
    reader.readAsDataURL(file);
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
      toast.error(err instanceof Error ? err.message : "Erro ao gerar sugestao");
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
      toast.error("Erro ao enviar reaÃ§Ã£o");
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

  async function handleOpenMembers() {
    setMembersOpen(true);
    setSelectedMember(null);
    setMembersLoading(true);
    const members = await getGroupLeadMembers(group.id).catch(() => []);
    setGroupMembers(members);
    setMembersLoading(false);
  }

  function handleOpenSenderLead(msg: GroupMessage) {
    const lead = msg.sender_lead;
    if (!lead) return;
    setMembersOpen(true);
    setSelectedMember({
      membership_id: msg.sender_membership_id ?? `message-${msg.id}`,
      phone: msg.sender_phone ?? lead.phone,
      name: msg.sender_name ?? lead.name,
      lead_id: lead.id,
      lead: {
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
      },
    });
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

  async function handleGetInviteLink() {
    try {
      const link = await getInviteLink(group.id);
      setInviteLink(link);
      toast.success("Link obtido");
    } catch (err: any) {
      toast.error(err.message || "Erro ao obter link");
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

  async function handleResetInviteLink() {
    setResettingLink(true);
    try {
      const link = await resetInviteLink(group.id);
      setInviteLink(link);
      toast.success("Link de convite renovado");
    } catch (err: any) {
      toast.error(err.message || "Erro ao renovar link");
    } finally {
      setResettingLink(false);
    }
  }

  async function handleLeaveGroup() {
    if (!confirm(`Sair do grupo "${group.name}"? O grupo serÃ¡ removido do CRM.`)) return;
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
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDateLabel(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Hoje";
    if (d.toDateString() === yesterday.toDateString()) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  function isSameDay(a: string, b: string) {
    return new Date(a).toDateString() === new Date(b).toDateString();
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

  const messagesByWhatsAppId = new Map(
    messages
      .filter((message) => Boolean(message.whatsapp_msg_id))
      .map((message) => [message.whatsapp_msg_id as string, message]),
  );

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
          {group.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.image_url} alt="" className="size-full object-cover" />
          ) : (
            <Users className="size-5 text-primary" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-[15px] leading-5 truncate">{group.name}</p>
          <p className="text-[13px] leading-5 text-muted-foreground truncate">
            {group.participant_count} membros Â· {CATEGORY_LABELS[group.category] || group.category}
            {group.is_announce && " Â· Anuncio"}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Members contact panel toggle */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleOpenMembers}
            className={`size-8 rounded-lg hover:bg-muted ${membersOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            title="Membros identificados"
          >
            <UserCircle className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setInviteOpen(true)} title="Enviar convite">
            <Users className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} title="ConfiguraÃ§Ãµes">
            <Settings className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {
                if (group.invite_link) {
                  navigator.clipboard.writeText(group.invite_link);
                  toast.success("Link copiado!");
                } else {
                  toast.error("Sem link de convite. Obtenha nas configuraÃ§Ãµes.");
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

      {/* Messages â€" WhatsApp wallpaper + bubble styling */}
      <div className="wa-chat-wallpaper flex-1 overflow-y-auto px-4">
        <div className="flex flex-col gap-1 py-4">
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
            messages.map((msg, idx) => {
              const isOutbound = msg.direction === "outbound";
              const showDateSep = idx === 0 || !isSameDay(messages[idx - 1].created_at, msg.created_at);
              const previousMsg = idx > 0 ? messages[idx - 1] : null;
              const senderKey = getMessageSenderKey(msg);
              const continuesPreviousBlock =
                Boolean(previousMsg) &&
                !showDateSep &&
                previousMsg!.direction === msg.direction &&
                getMessageSenderKey(previousMsg!) === senderKey;
              const showBlockHeader = !continuesPreviousBlock;
              const senderLead = msg.sender_lead ?? null;
              const senderAvatarUrl = senderLead?.avatar_url ?? msg.sender_avatar_url;
              const senderDisplayName =
                senderLead?.name ??
                msg.sender_name ??
                msg.sender_phone ??
                (msg.sender_identity_kind === "lid" ? "Participante sem telefone" : "Participante");
              const senderSecondary =
                senderLead?.phone ??
                msg.sender_phone ??
                (msg.sender_identity_kind === "lid" ? "Telefone nao disponivel" : null);
              const repliedMessage = msg.reply_to_whatsapp_msg_id
                ? messagesByWhatsAppId.get(msg.reply_to_whatsapp_msg_id) ?? null
                : null;

              return (
                <div key={msg.id}>
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
                          <button
                            type="button"
                            disabled={!senderLead}
                            onClick={() => handleOpenSenderLead(msg)}
                            className={`flex size-8 items-center justify-center overflow-hidden rounded-full border border-border/40 bg-primary/10 text-[11px] font-semibold text-primary ${
                              senderLead ? "cursor-pointer hover:ring-2 hover:ring-primary/25" : "cursor-default"
                            }`}
                            title={senderLead ? "Abrir perfil do lead" : senderSecondary ?? senderDisplayName}
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
                          </button>
                        )}
                      </div>
                    )}

                    {/* Reaction + context menu â€" visible on hover */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity self-end mb-1 shrink-0">
                      {/* Quick emoji reactions */}
                      {msg.whatsapp_msg_id && (
                        <DropdownMenu
                          open={reactingMsgId === msg.id}
                          onOpenChange={(o) => setReactingMsgId(o ? msg.id : null)}
                        >
                          <DropdownMenuTrigger
                            className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/10 transition-colors"
                            title="Reagir"
                          >
                            <Smile className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align={isOutbound ? "end" : "start"}
                            className="flex gap-1 p-1.5 min-w-0"
                          >
                            {QUICK_REACTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => handleReact(msg, emoji)}
                                className="text-lg hover:scale-125 transition-transform px-0.5"
                              >
                                {emoji}
                              </button>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {/* Context menu */}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/10 transition-colors"
                          title="Mais opÃ§Ãµes"
                        >
                          <ChevronDown className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align={isOutbound ? "end" : "start"} className="min-w-[140px]">
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
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDeleteMessage(msg)}
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
                        <p className="text-[11px] px-1" style={{ color: "var(--chat-timestamp)" }}>VocÃª</p>
                      ) : showBlockHeader ? (
                        <button
                          type="button"
                          disabled={!senderLead}
                          onClick={() => handleOpenSenderLead(msg)}
                          className={`flex max-w-[260px] items-center gap-1 px-1 text-left text-[11px] font-medium text-primary ${
                            senderLead ? "hover:underline" : "cursor-default"
                          }`}
                          title={senderSecondary ?? undefined}
                        >
                          <span className="truncate">{senderDisplayName}</span>
                          {senderLead && (
                            <Badge variant="secondary" className="h-4 px-1 text-[9px] leading-none">
                              Lead
                            </Badge>
                          )}
                        </button>
                      ) : null}
                      {showBlockHeader && !isOutbound && senderSecondary && senderSecondary !== senderDisplayName && (
                        <p className="max-w-[260px] truncate px-1 text-[10px] text-muted-foreground">
                          {senderSecondary}
                        </p>
                      )}

                      {/* Bubble */}
                      <div
                        className={`rounded-[7.5px] shadow-sm overflow-hidden ${
                          isOutbound ? "rounded-br-sm" : "rounded-bl-sm"
                        }`}
                        style={
                          isOutbound
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
                        {msg.media_type === "video" && (
                          <div className="flex items-center gap-2 px-2.5 pt-2">
                            <FileVideo className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">VÃ­deo</span>
                          </div>
                        )}
                        {msg.media_type === "audio" && (
                          <div className="flex items-center gap-2 px-2.5 pt-2">
                            <Mic className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Ãudio</span>
                          </div>
                        )}
                        {msg.media_type === "document" && (
                          <div className="flex items-center gap-2 px-2.5 pt-2">
                            <File className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Documento</span>
                          </div>
                        )}
                        {/* Text / caption */}
                        <div className="px-2.5 py-1.5 text-[14.2px] leading-5">
                          {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
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
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar â€" matching MessageInput style */}
      <div className="shrink-0 border-t border-[color:var(--chat-sidebar-divider)] px-3 py-2">
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
                {aiLoading ? "Gerando..." : "Gerar sugestao"}
              </Button>
              {aiDraft && (
                <div className="space-y-2">
                  <div className="max-h-36 overflow-y-auto rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">
                    {aiDraft}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setChatInput(aiDraft);
                      setAiOpen(false);
                      toast.success("Sugestao adicionada");
                    }}
                  >
                    <Copy className="size-3.5" />
                    Usar no campo
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex items-end gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 rounded-full hover:bg-transparent"
                style={{ color: "var(--chat-header-fg)" }}
                disabled={sendingMedia}
                title="Mais opcoes"
                aria-label="Mais opcoes"
              />
            }>
              {sendingMedia ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <Image className="size-4 text-primary" />
                Fotos e videos
              </DropdownMenuItem>
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

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 rounded-full hover:bg-transparent"
            style={{ color: "var(--chat-header-fg)" }}
            title="Emoji"
            aria-label="Emoji"
            onClick={() => setChatInput((current) => `${current}🙂`)}
            disabled={sendingMessage || sendingMedia}
          >
            <Smile className="size-4" />
          </Button>
          <Textarea
            name="group-message"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
            }}
            placeholder="Digite uma mensagem..."
            className="max-h-28 min-h-[42px] flex-1 resize-none rounded-lg px-4 py-[11px] text-[15px] leading-5 outline-none"
            style={{ background: "var(--chat-input-field-bg)", color: "var(--chat-header-fg)", border: "none", boxShadow: "none" }}
            rows={1}
            disabled={sendingMessage || sendingMedia}
          />
          <Button
            size="icon"
            onClick={handleSendMessage}
            disabled={sendingMessage || sendingMedia || !chatInput.trim()}
            className="size-10 shrink-0 rounded-full hover:opacity-90 disabled:opacity-70"
            style={{ backgroundColor: "var(--chat-send-bg)", color: "var(--chat-send-fg)" }}
          >
            {sendingMessage ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Members / contact panel â€" Sheet overlay, nÃ£o empurra o layout */}
      <Sheet open={membersOpen} onOpenChange={(o) => { if (!o) { setMembersOpen(false); setSelectedMember(null); } }}>
        <SheetContent side="right" showCloseButton={false} className="w-full max-w-[440px] p-0 overflow-hidden">
          {selectedMember ? (
            <LeadContactPanel
              lead={selectedMember.lead}
              onClose={() => setSelectedMember(null)}
            />
          ) : (
            <div className="flex h-full flex-col overflow-y-auto">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Membros identificados
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
                  <p className="text-sm text-muted-foreground">Nenhum membro identificado como lead</p>
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
                <div className="flex flex-col">
                  {groupMembers.map((member) => (
                    <button
                      key={member.membership_id}
                      type="button"
                      onClick={() => setSelectedMember(member)}
                      className="flex items-center gap-3 px-4 py-3 border-b border-border/30 hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <UserCircle className="size-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{member.lead.name || member.name || "Sem nome"}</p>
                        <p className="text-xs text-muted-foreground truncate">{member.lead.phone || member.phone || ""}</p>
                      </div>
                      <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Settings Sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>ConfiguraÃ§Ãµes do Grupo</SheetTitle>
            <SheetDescription>Edite nome, descriÃ§Ã£o, categoria e comportamento do grupo.</SheetDescription>
          </SheetHeader>
          <div className="px-card py-6 space-y-6">

            {/* â"€â"€ Identidade â"€â"€ */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identidade</p>
              <div className="space-y-form">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input name="group-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>DescriÃ§Ã£o</Label>
                  <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="min-h-16" placeholder="DescriÃ§Ã£o..." />
                </div>
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select value={editCategory} onValueChange={(v) => setEditCategory(v ?? "geral")}>
                    <SelectTrigger><SelectValue>{CATEGORY_LABELS[editCategory] ?? "Selecione"}</SelectValue></SelectTrigger>
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

            {/* â"€â"€ Comportamento â"€â"€ */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comportamento</p>
              <div className="space-y-form">
                <div className="space-y-1.5">
                  <Label>Mensagens temporÃ¡rias</Label>
                  <Select value={editEphemeral} onValueChange={(v) => setEditEphemeral((v ?? "off") as typeof editEphemeral)}>
                    <SelectTrigger>
                      <SelectValue>
                        {{ off: "Desativado", "1d": "Sumem em 1 dia", "7d": "Sumem em 7 dias", "90d": "Sumem em 90 dias" }[editEphemeral]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Desativado</SelectItem>
                      <SelectItem value="1d">Sumem em 1 dia</SelectItem>
                      <SelectItem value="7d">Sumem em 7 dias</SelectItem>
                      <SelectItem value="90d">Sumem em 90 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-lg border divide-y">
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2">
                      <Megaphone className="size-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Modo AnÃºncio</p>
                        <p className="text-xs text-muted-foreground">SÃ³ admins enviam mensagens</p>
                      </div>
                    </div>
                    <Switch checked={editAnnounce} onCheckedChange={setEditAnnounce} />
                  </div>
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Bloquear grupo</p>
                        <p className="text-xs text-muted-foreground">SÃ³ admins editam info do grupo</p>
                      </div>
                    </div>
                    <Switch checked={editLocked} onCheckedChange={setEditLocked} />
                  </div>
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">AprovaÃ§Ã£o para entrar</p>
                        <p className="text-xs text-muted-foreground">Admin aprova cada novo membro</p>
                      </div>
                    </div>
                    <Switch checked={editJoinApproval} onCheckedChange={setEditJoinApproval} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Quem pode adicionar membros</Label>
                  <Select value={editMemberAddMode} onValueChange={(v) => setEditMemberAddMode((v ?? "all_member_add") as typeof editMemberAddMode)}>
                    <SelectTrigger>
                      <SelectValue>
                        {{ all_member_add: "Todos os membros", admin_add: "Somente admins" }[editMemberAddMode]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_member_add">Todos os membros</SelectItem>
                      <SelectItem value="admin_add">Somente admins</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* â"€â"€ Convite â"€â"€ */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link de Convite</p>
              <div className="flex gap-2">
                <Input name="invite-link" value={inviteLink} readOnly placeholder="Clique em obter..." className="font-mono text-xs" />
                <Button variant="outline" size="icon-sm" title="Copiar link" onClick={() => {
                  if (inviteLink) { navigator.clipboard.writeText(inviteLink); toast.success("Copiado!"); }
                }} disabled={!inviteLink}>
                  <Copy className="size-4" />
                </Button>
                <Button variant="outline" size="icon-sm" title="Obter link atual" onClick={handleGetInviteLink}>
                  <RefreshCw className="size-4" />
                </Button>
                <Button variant="outline" size="icon-sm" title="Revogar e gerar novo link" onClick={handleResetInviteLink} disabled={resettingLink}>
                  {resettingLink ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Revogar invalida o link atual e gera um novo.</p>
            </div>

            <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? "Salvando..." : "Salvar alteraÃ§Ãµes"}
            </Button>

            {/* â"€â"€ Zona de perigo â"€â"€ */}
            <div className="pt-2 border-t">
              <Button
                variant="outline"
                className="w-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={handleLeaveGroup}
                disabled={leavingGroup}
              >
                {leavingGroup ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                {leavingGroup ? "Saindo..." : "Sair do grupo"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-1.5">
                Remove o nÃºmero do WhatsApp do grupo e o exclui do CRM.
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Send Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar Convite</DialogTitle>
            <DialogDescription>O lead receberÃ¡ o link de convite do grupo via WhatsApp.</DialogDescription>
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
      toast.success(campaignId ? "Grupo vinculado" : "VÃ­nculo removido");
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
            Crie uma campanha com link Ãºnico que distribui leads entre grupos automaticamente.
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
                  placeholder="Ex: LanÃ§amento ICBID"
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
                <Label className="text-xs">DistribuiÃ§Ã£o</Label>
                <Select value={newMode} onValueChange={(v) => setNewMode(v as "balanced" | "sequential")}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue>{newMode === "balanced" ? "Balanceado" : "Sequencial"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="balanced">Balanceado â€” distribui igualmente</SelectItem>
                    <SelectItem value="sequential">Sequencial â€” enche um por vez</SelectItem>
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
                      {" Â· "}{linkedGroups.length} grupos vinculados
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
                    <p className="text-xs text-muted-foreground">Nenhum grupo disponÃ­vel</p>
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
  const [campaigns, setCampaigns] = React.useState<GroupCampaign[]>([]);
  const [orgSlug, setOrgSlug] = React.useState("");
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

  // Create dialog
  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newCategory, setNewCategory] = React.useState("geral");

  // Campaign manager
  const [campaignOpen, setCampaignOpen] = React.useState(false);

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

  // Load campaigns + org slug
  React.useEffect(() => {
    getGroupCampaigns().then(setCampaigns, () => {});
    const supabase = createClient();
    supabase.from("organizations").select("slug").limit(1).single()
      .then(({ data }) => { if (data?.slug) setOrgSlug(data.slug as string); }, () => {});
  }, []);

  // Global Realtime subscription â€" notifica mensagens de grupos nÃ£o selecionados
  // e mantÃ©m contagem de nÃ£o lidas no painel lateral.
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

          // Atualiza preview da Ãºltima mensagem no painel lateral
          setLastMessages((prev) => ({
            ...prev,
            [group_id]: { text, sender: sender_name, direction, at: created_at },
          }));

          // SÃ³ notifica/incrementa unread para grupos fora de foco
          if (group_id === selectedIdRef.current) return;

          setUnreadCounts((prev) => ({ ...prev, [group_id]: (prev[group_id] ?? 0) + 1 }));

          const grp = groupsRef.current.find((g) => g.id === group_id);
          if (grp) {
            const sender = sender_name || "Participante";
            const preview = text
              ? text.length > 60 ? text.slice(0, 60) + "â€¦" : text
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
    // Zera nÃ£o lidas ao abrir o grupo
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

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const newGroup = await createGroup(newName.trim(), [], newCategory);
      setGroups((prev) => [newGroup as Group, ...prev]);
      setCreateOpen(false);
      setNewName("");
      setNewCategory("geral");
      setSelectedId((newGroup as Group).id);
      toast.success("Grupo criado");
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar grupo");
    } finally {
      setCreating(false);
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
          onCreateOpen={() => setCreateOpen(true)}
          onSync={handleSync}
          syncing={syncing}
          onCampaignOpen={() => setCampaignOpen(true)}
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

      {/* Campaign Manager Sheet */}
      <CampaignManagerSheet
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        campaigns={campaigns}
        groups={groups}
        orgSlug={orgSlug}
        onCampaignsChange={setCampaigns}
      />

      {/* Create Group Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Grupo</DialogTitle>
            <DialogDescription>Cria um novo grupo no WhatsApp com link de convite automÃ¡tico.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Grupo</Label>
              <Input
                name="group-name"
                placeholder="Ex: Grupo VIP - LanÃ§amento X"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={newCategory} onValueChange={(v) => setNewCategory(v ?? "geral")}>
                <SelectTrigger><SelectValue>{CATEGORY_LABELS[newCategory] ?? "Selecione"}</SelectValue></SelectTrigger>
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
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "Criando..." : "Criar Grupo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
