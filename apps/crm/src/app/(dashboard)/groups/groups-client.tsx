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
  Zap,
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
  getGroupLeadMembers,
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
  created_at: string;
  updated_at: string;
}

interface GroupMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  sender_name: string | null;
  created_at: string;
  whatsapp_msg_id: string | null;
  media_url: string | null;
  media_type: string | null;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏"];

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

// ─── Left panel: group list ───────────────────────────────────────────────────

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
}) {
  const filtered = groups.filter((g) => {
    const matchesSearch = g.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "todos" || g.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[color:var(--chat-sidebar-divider)]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-base">Grupos WhatsApp</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={onCampaignOpen} title="Campanhas / Link Inteligente">
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

        {/* Search */}
        <div className="relative">
          <Input
            name="search"
            placeholder="Buscar grupo..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="h-8 text-sm pl-3"
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-1 mt-2 overflow-x-auto pb-0.5 no-scrollbar">
          {["todos", "geral", "aquecimento", "evento", "oferta", "alunos"].map((cat) => (
            <Button
              key={cat}
              variant="ghost"
              onClick={() => onCategoryFilter(cat)}
              className={`shrink-0 h-7 text-xs px-2.5 rounded-full transition-colors ${
                categoryFilter === cat
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat === "todos" ? "Todos" : CATEGORY_LABELS[cat]}
            </Button>
          ))}
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
          filtered.map((group) => (
            <Button
              key={group.id}
              variant="ghost"
              onClick={() => onSelect(group.id)}
              className={`w-full justify-start h-auto text-left px-4 py-3 rounded-none border-b border-border/30 hover:bg-muted/50 ${
                selectedId === group.id ? "bg-primary/5 border-l-2 border-l-primary" : ""
              }`}
            >
              {/* Avatar */}
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Users className="size-5 text-primary" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold truncate">{group.name}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    {group.campaign_id && <Link2 className="size-3 text-primary" />}
                    {!group.is_accepting && <span className="text-[10px] text-destructive font-medium">Fechado</span>}
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 ${CATEGORY_COLORS[group.category] || ""}`}
                    >
                      {CATEGORY_LABELS[group.category] || group.category}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <Users className="size-3 shrink-0" />
                  <span>{group.participant_count}/{group.max_participants}</span>
                  {group.is_announce && (
                    <>
                      <span>·</span>
                      <Megaphone className="size-3 shrink-0" />
                      <span>Anuncio</span>
                    </>
                  )}
                </div>
                {/* Capacity bar */}
                <div className="mt-1.5 h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all bg-primary"
                    style={{ width: `${Math.min(100, Math.round(((group.participant_count ?? 0) / (group.max_participants || 256)) * 100))}%` }}
                  />
                </div>
              </div>
            </Button>
          ))
        )}
      </div>

      {/* Footer count */}
      <div className="px-4 py-2 border-t border-border/30 text-xs text-muted-foreground">
        {groups.length} grupos
      </div>
    </div>
  );
}

// ─── Right panel: empty state ─────────────────────────────────────────────────

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

// ─── Right panel: group chat ──────────────────────────────────────────────────

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
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
  }, [group.id]);

  // Load initial messages
  React.useEffect(() => {
    setLoadingMsgs(true);
    setMessages([]);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("group_messages")
      .select("id, direction, text, sender_name, created_at, whatsapp_msg_id, media_url, media_type")
      .eq("group_id", group.id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
      .limit(50)
      .then(({ data }: { data: GroupMessage[] | null }) => {
        setMessages(data || []);
        setLoadingMsgs(false);
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
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
          if (payload.new.direction === "inbound") {
            const sender = payload.new.sender_name || "Participante";
            const preview = payload.new.text
              ? payload.new.text.length > 60
                ? payload.new.text.slice(0, 60) + "…"
                : payload.new.text
              : "Nova mensagem";
            toast.message(`${group.name}`, {
              description: `${sender}: ${preview}`,
            });
          }
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
    try {
      await sendMessageToGroup(group.id, text);
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar mensagem");
      setChatInput(text);
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
      try {
        await sendMediaToGroup(group.id, base64, mediaType, undefined, file.name);
        toast.success("Mídia enviada");
      } catch (err: any) {
        toast.error(err.message || "Erro ao enviar mídia");
      } finally {
        setSendingMedia(false);
      }
    };
    reader.readAsDataURL(file);
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

  async function handleOpenMembers() {
    setMembersOpen(true);
    setSelectedMember(null);
    setMembersLoading(true);
    const members = await getGroupLeadMembers(group.id).catch(() => []);
    setGroupMembers(members);
    setMembersLoading(false);
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — WhatsApp style matching chat-window */}
      <div
        className="flex h-[59px] shrink-0 items-center gap-3 border-b border-[color:var(--chat-sidebar-divider)] px-4"
        style={{ background: "var(--chat-header-bg)", color: "var(--chat-header-fg)" }}
      >
        <Button variant="ghost" size="icon-sm" onClick={onBack} className="md:hidden">
          <ArrowLeft className="size-4" />
        </Button>

        <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Users className="size-5 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-[15px] leading-5 truncate">{group.name}</p>
          <p className="text-[13px] leading-5 text-muted-foreground truncate">
            {group.participant_count} membros · {CATEGORY_LABELS[group.category] || group.category}
            {group.is_announce && " · Anuncio"}
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
          <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} title="Configurações">
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

      {/* Messages — WhatsApp wallpaper + bubble styling */}
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
                    className={`group/msg flex max-w-[86%] items-end gap-1 sm:max-w-[72%] ${
                      isOutbound ? "ml-auto flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {/* Reaction + context menu — visible on hover */}
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
                          title="Mais opções"
                        >
                          <ChevronDown className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align={isOutbound ? "end" : "start"} className="min-w-[140px]">
                          {msg.text && (
                            <DropdownMenuItem onClick={() => {
                              navigator.clipboard.writeText(msg.text!); toast.success("Copiado!");
                            }}>
                              <Copy className="size-4" />
                              Copiar
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
                      {isOutbound ? (
                        <p className="text-[11px] px-1" style={{ color: "var(--chat-timestamp)" }}>Você</p>
                      ) : msg.sender_name ? (
                        <p className="text-[11px] px-1 font-medium text-primary">{msg.sender_name}</p>
                      ) : null}

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
                            <span className="text-[13px] text-muted-foreground">Vídeo</span>
                          </div>
                        )}
                        {msg.media_type === "audio" && (
                          <div className="flex items-center gap-2 px-2.5 pt-2">
                            <Mic className="size-5 text-muted-foreground" />
                            <span className="text-[13px] text-muted-foreground">Áudio</span>
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

      {/* Input bar — matching MessageInput style */}
      <div className="shrink-0 border-t border-[color:var(--chat-sidebar-divider)] px-3 py-2">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex items-end gap-1">
          {/* Attach button */}
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 rounded-full hover:bg-transparent"
            style={{ color: "var(--chat-header-fg)" }}
            onClick={() => fileInputRef.current?.click()}
            disabled={sendingMedia}
            title="Anexar mídia"
          >
            {sendingMedia ? <Loader2 className="size-5 animate-spin" /> : <Paperclip className="size-5" />}
          </Button>
          <Textarea
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

      {/* Members / contact panel — Sheet overlay, não empurra o layout */}
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
                <Button variant="ghost" size="icon-xs" onClick={() => setMembersOpen(false)} aria-label="Fechar">
                  <X className="size-3.5" />
                </Button>
              </div>
              {membersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : groupMembers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
                  <UserCircle className="size-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nenhum membro identificado como lead</p>
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
            <SheetTitle>Configurações do Grupo</SheetTitle>
            <SheetDescription>Edite nome, descrição, categoria e comportamento do grupo.</SheetDescription>
          </SheetHeader>
          <div className="px-card py-6 space-y-6">

            {/* ── Identidade ── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identidade</p>
              <div className="space-y-form">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input name="group-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Descrição</Label>
                  <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="min-h-16" placeholder="Descrição..." />
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

            {/* ── Comportamento ── */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comportamento</p>
              <div className="space-y-form">
                <div className="space-y-1.5">
                  <Label>Mensagens temporárias</Label>
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
                        <p className="text-xs text-muted-foreground">Só admins editam info do grupo</p>
                      </div>
                    </div>
                    <Switch checked={editLocked} onCheckedChange={setEditLocked} />
                  </div>
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Aprovação para entrar</p>
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

            {/* ── Convite ── */}
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
              {saving ? "Salvando..." : "Salvar alterações"}
            </Button>

            {/* ── Zona de perigo ── */}
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
                Remove o número do WhatsApp do grupo e o exclui do CRM.
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

// ─── Lead type for invite ─────────────────────────────────────────────────────

interface Lead {
  id: string;
  name: string;
  phone: string | null;
}

// ─── Campaign Manager Sheet ───────────────────────────────────────────────────

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

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

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
                      {" · "}{linkedGroups.length} grupos vinculados
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

// ─── Main page component ──────────────────────────────────────────────────────

export function GroupsClient({ initialGroups }: { initialGroups: Group[] }) {
  const [groups, setGroups] = React.useState<Group[]>(initialGroups);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [campaigns, setCampaigns] = React.useState<GroupCampaign[]>([]);
  const [orgSlug, setOrgSlug] = React.useState("");

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
          onSelect={setSelectedId}
          onCreateOpen={() => setCreateOpen(true)}
          onSync={handleSync}
          syncing={syncing}
          onCampaignOpen={() => setCampaignOpen(true)}
          search={search}
          onSearch={setSearch}
          categoryFilter={categoryFilter}
          onCategoryFilter={setCategoryFilter}
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
            <DialogDescription>Cria um novo grupo no WhatsApp com link de convite automático.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Grupo</Label>
              <Input
                name="group-name"
                placeholder="Ex: Grupo VIP - Lançamento X"
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
