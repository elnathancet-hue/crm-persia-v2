"use client";

import * as React from "react";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  Users,
  Link2,
  Save,
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
  getInviteLink,
  updateGroup,
  sendInviteToLead,
} from "@/actions/groups";
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
  is_announce: boolean;
  category: string;
  created_at: string;
  updated_at: string;
}

interface GroupMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  sender_name: string | null;
  created_at: string;
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

// ─── Left panel: group list ───────────────────────────────────────────────────

function GroupListPanel({
  groups,
  selectedId,
  onSelect,
  onCreateOpen,
  onSync,
  syncing,
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
          <div className="flex flex-col items-center justify-center h-full py-12 text-center px-4">
            <Users className="size-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">Nenhum grupo</p>
            <p className="text-xs text-muted-foreground mt-1">
              {search || categoryFilter !== "todos"
                ? "Tente outro filtro"
                : "Crie ou sincronize grupos do WhatsApp"}
            </p>
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
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 shrink-0 ${CATEGORY_COLORS[group.category] || ""}`}
                  >
                    {CATEGORY_LABELS[group.category] || group.category}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <Users className="size-3 shrink-0" />
                  <span>{group.participant_count} membros</span>
                  {group.is_announce && (
                    <>
                      <span>·</span>
                      <Megaphone className="size-3 shrink-0" />
                      <span>Anuncio</span>
                    </>
                  )}
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
}: {
  group: Group;
  leads: Lead[];
  onBack: () => void;
  onDelete: (id: string) => void;
}) {
  const [messages, setMessages] = React.useState<GroupMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = React.useState(true);
  const [chatInput, setChatInput] = React.useState("");
  const [sendingMessage, setSendingMessage] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Settings sheet state
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [editName, setEditName] = React.useState(group.name);
  const [editDescription, setEditDescription] = React.useState(group.description || "");
  const [editAnnounce, setEditAnnounce] = React.useState(group.is_announce);
  const [editCategory, setEditCategory] = React.useState(group.category);
  const [saving, setSaving] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState(group.invite_link || "");

  // Invite dialog
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selectedLeadId, setSelectedLeadId] = React.useState("");
  const [sendingInvite, setSendingInvite] = React.useState(false);

  // Reset when group changes
  React.useEffect(() => {
    setEditName(group.name);
    setEditDescription(group.description || "");
    setEditAnnounce(group.is_announce);
    setEditCategory(group.category);
    setInviteLink(group.invite_link || "");
  }, [group.id]);

  // Load initial messages
  React.useEffect(() => {
    setLoadingMsgs(true);
    setMessages([]);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("group_messages")
      .select("id, direction, text, sender_name, created_at")
      .eq("group_id", group.id)
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
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [group.id]);

  // Scroll to bottom
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

  async function handleSaveSettings() {
    setSaving(true);
    try {
      await updateGroup(group.id, {
        name: editName.trim(),
        description: editDescription.trim(),
        is_announce: editAnnounce,
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-background shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={onBack} className="md:hidden">
          <ArrowLeft className="size-4" />
        </Button>

        <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Users className="size-5 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{group.name}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{group.participant_count} membros</span>
            <span>·</span>
            <span>{CATEGORY_LABELS[group.category] || group.category}</span>
            {group.is_announce && (
              <>
                <span>·</span>
                <Megaphone className="size-3" />
                <span>Anuncio</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-[color:var(--chat-bg)]">
        {loadingMsgs ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              variant="subtle"
              icon={<MessageSquare />}
              title="Nenhuma mensagem ainda"
              description="Envie a primeira mensagem para o grupo"
            />
          </div>
        ) : (
          messages.map((msg, idx) => (
            <React.Fragment key={msg.id}>
              {(idx === 0 || !isSameDay(messages[idx - 1].created_at, msg.created_at)) && (
                <div className="flex items-center justify-center my-3">
                  <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {formatDateLabel(msg.created_at)}
                  </span>
                </div>
              )}
            <div
              className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] px-3 py-2 text-sm shadow-sm ${
                  msg.direction === "outbound"
                    ? "rounded-2xl rounded-br-sm bg-[color:var(--chat-bubble-out)] text-[color:var(--chat-bubble-out-text)]"
                    : "rounded-2xl rounded-bl-sm bg-[color:var(--chat-bubble-in)] text-[color:var(--chat-bubble-in-text)] border"
                }`}
              >
                {msg.direction === "inbound" && msg.sender_name && (
                  <p className="text-xs font-semibold mb-1 text-primary">{msg.sender_name}</p>
                )}
                <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
                <p className={`text-[10px] mt-1 text-right opacity-60 ${
                  msg.direction === "outbound"
                    ? "text-[color:var(--chat-bubble-out-text)]"
                    : "text-muted-foreground"
                }`}>
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
            </React.Fragment>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="flex items-end gap-2 px-4 py-3 border-t bg-background shrink-0">
        <Textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
          }}
          placeholder="Digite uma mensagem..."
          className="min-h-[40px] max-h-32 resize-none"
          rows={1}
          disabled={sendingMessage}
        />
        <Button
          size="icon"
          onClick={handleSendMessage}
          disabled={sendingMessage || !chatInput.trim()}
          className="shrink-0"
        >
          {sendingMessage ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>

      {/* Settings Sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-[360px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Configurações do Grupo</SheetTitle>
            <SheetDescription>Edite nome, descrição, categoria e modo do grupo.</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 mt-6">
            {/* Invite link */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Link de Convite</Label>
              <div className="flex gap-2">
                <Input value={inviteLink} readOnly placeholder="Clique em obter..." className="font-mono text-xs" />
                <Button variant="outline" size="icon-sm" onClick={() => {
                  if (inviteLink) { navigator.clipboard.writeText(inviteLink); toast.success("Copiado!"); }
                }} disabled={!inviteLink}>
                  <Copy className="size-4" />
                </Button>
                <Button variant="outline" size="icon-sm" onClick={handleGetInviteLink}>
                  <RefreshCw className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="min-h-16" placeholder="Descrição..." />
            </div>
            <div className="space-y-2">
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
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Modo Anuncio</p>
                <p className="text-xs text-muted-foreground">Só admins enviam mensagens</p>
              </div>
              <Switch checked={editAnnounce} onCheckedChange={setEditAnnounce} />
            </div>
            <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? "Salvando..." : "Salvar"}
            </Button>
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
              <SelectTrigger><SelectValue placeholder="Selecione um lead..." /></SelectTrigger>
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

// ─── Main page component ──────────────────────────────────────────────────────

export function GroupsClient({ initialGroups }: { initialGroups: Group[] }) {
  const [groups, setGroups] = React.useState<Group[]>(initialGroups);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [leads, setLeads] = React.useState<Lead[]>([]);

  // Create dialog
  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newCategory, setNewCategory] = React.useState("geral");

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
          />
        ) : (
          <GroupEmptyState />
        )}
      </div>

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
