"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ImageIcon,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Users,
  UserCheck,
  UserX2,
  Flame,
  LogOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import { Badge } from "@persia/ui/badge";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { EmptyState } from "@persia/ui/empty-state";
import { StatusBadge } from "@persia/ui/status-badge";
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
  Copy,
  Phone,
  UserPlus,
  ExternalLink,
  ShieldCheck,
  Crown,
  UserX,
  Tag,
  CheckSquare,
  Square,
  Zap,
  Trash2,
} from "lucide-react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@persia/ui/tabs";
import {
  createGroup,
  syncGroups,
  getGroupsOverview,
  getGroupParticipantsView,
  createLeadFromParticipant,
  bulkAddTagToGroupLeads,
  getGroupAutomations,
  upsertGroupAutomation,
  deleteGroupAutomation,
  backfillGroupParticipantAvatars,
  syncGroupImages,
  type GroupOverview,
  type GroupParticipantView,
  type GroupAutomation,
  type GroupAutomationTrigger,
} from "@/actions/groups";
import { findOrCreateConversationByLead } from "@/actions/conversations";
import { getOrgTags } from "@/actions/leads";

const CATEGORY_LABELS: Record<string, string> = {
  geral: "Geral",
  aquecimento: "Aquecimento",
  evento: "Evento",
  oferta: "Oferta",
  alunos: "Alunos",
};

function exportGroupCSV(group: GroupOverview) {
  const header = "Grupo,Campanha,Ocupação,Leads Identificados,Duplicados,Status\n";
  const row = `"${group.name}","${group.campaign_name ?? ""}","${group.participant_count}/${group.max_participants}",${group.identified_leads},${group.duplicates},"${group.is_accepting ? "Ativo" : "Lotado"}"`;
  const blob = new Blob([header + row], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${group.name.replace(/[^a-z0-9]/gi, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAllCSV(groups: GroupOverview[]) {
  const header = "Grupo,Campanha,Ocupação,Leads Identificados,Duplicados,Status\n";
  const rows = groups
    .map(
      (g) =>
        `"${g.name}","${g.campaign_name ?? ""}","${g.participant_count}/${g.max_participants}",${g.identified_leads},${g.duplicates},"${g.is_accepting ? "Ativo" : "Lotado"}"`,
    )
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "grupos.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function ParticipantRow({
  participant: p,
  onOpenProfile,
  onOpenChat,
  onCreateLead,
  onToggleSelect,
  selected,
  chatLoading,
  createLoading,
}: {
  participant: GroupParticipantView;
  onOpenProfile: (leadId: string) => void;
  onOpenChat: (leadId: string) => void;
  onCreateLead: (participant: GroupParticipantView) => void;
  onToggleSelect: (id: string) => void;
  selected: boolean;
  chatLoading: boolean;
  createLoading: boolean;
}) {
  const selectable = Boolean(p.lead) || p.identityKind === "phone";

  function copyPhone() {
    if (!p.phone) return;
    navigator.clipboard.writeText(p.phone);
    toast.success("Telefone copiado");
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
      {/* Checkbox de seleção */}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={selected ? "Desmarcar" : "Selecionar"}
        disabled={!selectable}
        onClick={(e) => { e.stopPropagation(); onToggleSelect(p.id); }}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        {selected ? <CheckSquare className="size-4 text-primary" /> : <Square className="size-4" />}
      </Button>
      {/* Avatar */}
      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        {p.lead?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.lead.avatar_url} alt="" className="size-8 rounded-full object-cover" />
        ) : (
          <Users className="size-4 text-primary" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate">
            {p.lead?.name ?? p.displayName ?? (p.phone ? p.phone : "Sem nome")}
          </span>
          {p.isSuperAdmin && <Badge variant="secondary" className="text-[10px] px-1 py-0 leading-tight"><Crown className="size-2.5 mr-0.5" />Dono</Badge>}
          {p.isAdmin && !p.isSuperAdmin && <Badge variant="secondary" className="text-[10px] px-1 py-0 leading-tight"><ShieldCheck className="size-2.5 mr-0.5" />Admin</Badge>}
          {p.lead && <Badge variant="default" className="text-[10px] px-1 py-0 leading-tight">Lead</Badge>}
          {!p.lead && p.identityKind === "phone" && <Badge variant="outline" className="text-[10px] px-1 py-0 leading-tight">Nao id.</Badge>}
          {p.identityKind === "lid" && <Badge variant="outline" className="text-[10px] px-1 py-0 leading-tight text-muted-foreground"><UserX className="size-2.5 mr-0.5" />LID</Badge>}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {p.phone ?? p.rawJid}
        </p>
      </div>

      {/* Acoes */}
      <div className="flex items-center gap-1 shrink-0">
        {p.lead && (
          <Button
            variant="ghost"
            size="icon-xs"
            title="Ver perfil"
            onClick={() => onOpenProfile(p.lead!.id)}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        )}
        {p.lead && (
          <Button
            variant="ghost"
            size="icon-xs"
            title="Abrir chat"
            disabled={chatLoading}
            onClick={() => onOpenChat(p.lead!.id)}
          >
            {chatLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MessageSquare className="size-3.5" />
            )}
          </Button>
        )}
        {p.phone && (
          <Button
            variant="ghost"
            size="icon-xs"
            title="Copiar telefone"
            onClick={copyPhone}
          >
            <Copy className="size-3.5" />
          </Button>
        )}
        {!p.lead && p.identityKind === "phone" && (
          <Button
            variant="ghost"
            size="icon-xs"
            title="Criar lead"
            disabled={createLoading}
            onClick={() => onCreateLead(p)}
          >
            {createLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <UserPlus className="size-3.5" />
            )}
          </Button>
        )}
        {p.identityKind === "lid" && (
          <Button
            variant="ghost"
            size="icon-xs"
            disabled
            title="Telefone nao disponivel pela API"
          >
            <Phone className="size-3.5 opacity-30" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function GroupsTab() {
  const router = useRouter();
  const [groups, setGroups] = React.useState<GroupOverview[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [syncing, setSyncing] = React.useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newCategory, setNewCategory] = React.useState("geral");
  const [creating, setCreating] = React.useState(false);
  const [participantsOpen, setParticipantsOpen] = React.useState(false);
  const [participantsGroup, setParticipantsGroup] = React.useState<GroupOverview | null>(null);
  const [participants, setParticipants] = React.useState<GroupParticipantView[]>([]);
  const [participantsLoading, setParticipantsLoading] = React.useState(false);
  const [participantsError, setParticipantsError] = React.useState<string | null>(null);
  const [participantsSearch, setParticipantsSearch] = React.useState("");
  const [participantsTab, setParticipantsTab] = React.useState("todos");
  const [chatLoadingLeadId, setChatLoadingLeadId] = React.useState<string | null>(null);
  const [createLoadingJid, setCreateLoadingJid] = React.useState<string | null>(null);
  // Bulk selection & actions
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [orgTags, setOrgTags] = React.useState<{ id: string; name: string; color: string }[]>([]);
  const [bulkTagId, setBulkTagId] = React.useState("");
  const [bulkLoading, setBulkLoading] = React.useState(false);
  // Etapa 7: backfill de fotos
  const [syncingPhotos, setSyncingPhotos] = React.useState(false);
  // Automations dialog — Etapa 8
  const [automsOpen, setAutomsOpen] = React.useState(false);
  const [automsGroup, setAutomsGroup] = React.useState<GroupOverview | null>(null);
  const [automs, setAutoms] = React.useState<GroupAutomation[]>([]);
  const [automsLoading, setAutomsLoading] = React.useState(false);
  const [newAutoTrigger, setNewAutoTrigger] = React.useState<GroupAutomationTrigger>("member_joined");
  const [newAutoTagId, setNewAutoTagId] = React.useState("");
  const [newAutoSaving, setNewAutoSaving] = React.useState(false);
  const [deletingAutoId, setDeletingAutoId] = React.useState<string | null>(null);

  React.useEffect(() => {
    getGroupsOverview()
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await syncGroups();
      toast.success(`${result.synced} grupos sincronizados`);
      const fresh = await getGroupsOverview();
      setGroups(fresh);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createGroup(newName.trim(), [], newCategory);
      toast.success("Grupo criado");
      setCreateOpen(false);
      setNewName("");
      setNewCategory("geral");
      const fresh = await getGroupsOverview();
      setGroups(fresh);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao criar grupo");
    } finally {
      setCreating(false);
    }
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleSelectAll(visibleParticipants: GroupParticipantView[]) {
    const selectable = visibleParticipants
      .filter((p) => Boolean(p.lead) || p.identityKind === "phone")
      .map((p) => p.id);
    const allSelected = selectable.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectable.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectable.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  async function loadTagsIfNeeded() {
    if (orgTags.length === 0) {
      try {
        const tags = await getOrgTags();
        setOrgTags(tags as { id: string; name: string; color: string }[]);
      } catch {
        toast.error("Erro ao carregar tags");
      }
    }
  }

  function handleBulkExportCSV(groupName: string) {
    const selected = participants.filter((p) => selectedIds.has(p.id));
    const header = "Nome,Telefone,JID,Status Lead,Grupo\n";
    const rows = selected
      .map((p) => {
        const name = p.lead?.name ?? p.displayName ?? "";
        const phone = p.phone ?? "";
        const status = p.lead?.status ?? "";
        return `"${name}","${phone}","${p.rawJid}","${status}","${groupName}"`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `participantes_${groupName.replace(/[^a-z0-9]/gi, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleBulkAddTag() {
    if (!bulkTagId) { toast.error("Selecione uma tag"); return; }
    const leadIds = participants
      .filter((p) => selectedIds.has(p.id) && p.lead)
      .map((p) => p.lead!.id);
    if (leadIds.length === 0) { toast.error("Nenhum lead selecionado"); return; }
    setBulkLoading(true);
    try {
      const { success, failed } = await bulkAddTagToGroupLeads(leadIds, bulkTagId);
      if (failed === 0) {
        toast.success(`Tag adicionada a ${success} lead${success !== 1 ? "s" : ""}`);
      } else {
        toast.warning(`Tag adicionada a ${success} de ${leadIds.length} (${failed} falha${failed !== 1 ? "s" : ""})`);
      }
      setBulkTagId("");
      setSelectedIds(new Set());
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao aplicar tag");
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleOpenAutomations(group: GroupOverview) {
    setAutomsGroup(group);
    setAutoms([]);
    setNewAutoTrigger("member_joined");
    setNewAutoTagId("");
    setAutomsOpen(true);
    setAutomsLoading(true);
    try {
      const list = await getGroupAutomations(group.id);
      setAutoms(list);
    } catch {
      toast.error("Erro ao carregar automações");
    } finally {
      setAutomsLoading(false);
    }
    loadTagsIfNeeded();
  }

  async function handleAddAutomation() {
    if (!automsGroup || !newAutoTagId) { toast.error("Selecione uma tag"); return; }
    setNewAutoSaving(true);
    try {
      await upsertGroupAutomation({
        groupId: automsGroup.id,
        trigger: newAutoTrigger,
        action_type: "add_tag",
        action_payload: { tag_id: newAutoTagId },
      });
      toast.success("Automação criada");
      setNewAutoTagId("");
      const list = await getGroupAutomations(automsGroup.id);
      setAutoms(list);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao criar automação");
    } finally {
      setNewAutoSaving(false);
    }
  }

  async function handleDeleteAutomation(autoId: string) {
    setDeletingAutoId(autoId);
    try {
      await deleteGroupAutomation(autoId);
      setAutoms((prev) => prev.filter((a) => a.id !== autoId));
      toast.success("Automação removida");
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao remover automação");
    } finally {
      setDeletingAutoId(null);
    }
  }

  async function handleSyncPhotos() {
    setSyncingPhotos(true);
    try {
      const result = await syncGroupImages();
      if (result.updated > 0) {
        const fresh = await getGroupsOverview();
        setGroups(fresh);
      }
      toast.success(
        `Fotos: ${result.processed} processados, ${result.updated} atualizados, ${result.skipped} sem foto, ${result.failed} falhas`,
      );
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao atualizar fotos");
    } finally {
      setSyncingPhotos(false);
    }
  }

  async function handleCreateLead(participant: GroupParticipantView) {
    if (!participant.phone) return;
    setCreateLoadingJid(participant.rawJid);
    try {
      const { leadId, created } = await createLeadFromParticipant(
        participantsGroup!.id,
        {
          rawJid: participant.rawJid,
          phone: participant.phone,
          displayName: participant.displayName,
        },
      );
      toast.success(
        created
          ? "Lead criado com sucesso"
          : "Lead já existia — membership vinculada",
      );
      // Re-fetch para atualizar badges na lista
      if (participantsGroup) await handleViewParticipants(participantsGroup);
      // Opcional: abrir perfil recém-criado
      router.prefetch(`/crm?tab=leads&lead=${leadId}`);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao criar lead");
    } finally {
      setCreateLoadingJid(null);
    }
  }

  async function handleOpenChat(leadId: string) {
    setChatLoadingLeadId(leadId);
    try {
      const { conversationId } = await findOrCreateConversationByLead(leadId);
      setParticipantsOpen(false);
      router.push(`/chat?c=${conversationId}`);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Erro ao abrir chat");
    } finally {
      setChatLoadingLeadId(null);
    }
  }

  async function handleViewParticipants(group: GroupOverview) {
    setParticipantsGroup(group);
    setParticipants([]);
    setParticipantsError(null);
    setParticipantsSearch("");
    setParticipantsTab("todos");
    setSelectedIds(new Set());
    setBulkTagId("");
    setParticipantsOpen(true);
    setParticipantsLoading(true);
    try {
      const result = await getGroupParticipantsView(group.id);
      setParticipants(result);
    } catch (err: unknown) {
      setParticipantsError((err as Error).message || "Erro ao buscar participantes");
    } finally {
      setParticipantsLoading(false);
    }
  }

  const filtered = groups.filter(
    (g) =>
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      (g.campaign_name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const totalDuplicates = groups.reduce((acc, g) => acc + g.duplicates, 0);
  const totalParticipants = groups.reduce((acc, g) => acc + g.participant_count, 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <Input
            name="search-groups"
            placeholder="Buscar grupo ou campanha..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-72"
          />
          {totalDuplicates > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-warning-soft text-warning shrink-0">
              <AlertTriangle className="size-3" />
              {totalDuplicates} duplicado{totalDuplicates !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportAllCSV(groups)}
            disabled={groups.length === 0}
          >
            <Download className="size-4" />
            Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={handleSyncPhotos} disabled={syncingPhotos || groups.length === 0} title="Buscar fotos dos grupos no WhatsApp">
            {syncingPhotos ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImageIcon className="size-4" />
            )}
            Atualizar fotos
          </Button>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Sincronizar
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Criar grupo
          </Button>
        </div>
      </div>

      {/* Métricas comerciais — Etapa 7 */}
      {!loading && groups.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            {
              label: "Participantes",
              value: groups.reduce((a, g) => a + g.participant_count, 0),
              icon: <Users className="size-4 text-primary" />,
              color: "bg-primary/8",
            },
            {
              label: "Leads id.",
              value: groups.reduce((a, g) => a + g.identified_leads, 0),
              icon: <UserCheck className="size-4 text-success" />,
              color: "bg-success/8",
            },
            {
              label: "Não id.",
              value: groups.reduce((a, g) => a + g.unidentified_count, 0),
              icon: <Users className="size-4 text-warning" />,
              color: "bg-warning/8",
            },
            {
              label: "Sem telefone",
              value: groups.reduce((a, g) => a + g.lid_count, 0),
              icon: <UserX2 className="size-4 text-muted-foreground" />,
              color: "bg-muted/40",
            },
            {
              label: "Engajados",
              value: groups.reduce((a, g) => a + g.engaged_count, 0),
              icon: <Flame className="size-4 text-progress" />,
              color: "bg-progress/8",
            },
            {
              label: "Saídas (7d)",
              value: groups.reduce((a, g) => a + g.recent_exits, 0),
              icon: <LogOut className="size-4 text-destructive" />,
              color: "bg-destructive/8",
            },
          ].map((card) => (
            <div
              key={card.label}
              className={`rounded-xl border p-3 flex items-center gap-3 ${card.color}`}
            >
              <div className="shrink-0">{card.icon}</div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{card.label}</p>
                <p className="text-lg font-semibold tabular-nums leading-tight">
                  {card.value.toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="subtle"
          icon={<Users />}
          title={search ? "Nenhum grupo encontrado" : "Nenhum grupo ainda"}
          description={
            search
              ? "Tente outro termo de busca"
              : "Crie um grupo ou sincronize do WhatsApp"
          }
          action={
            !search ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Criar grupo
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Grupo
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Campanha
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Ocupação
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Leads id.
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Não id.
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Duplicados
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-2 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((group) => {
                  const pct = Math.min(
                    100,
                    Math.round(
                      (group.participant_count / (group.max_participants || 256)) * 100,
                    ),
                  );
                  const isFull = !group.is_accepting || pct >= 100;

                  return (
                    <tr key={group.id} className="hover:bg-muted/30 transition-colors">
                      {/* Grupo */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                            {group.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={group.image_url} alt="" className="size-8 object-cover" />
                            ) : (
                              <Users className="size-4 text-primary" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[180px]">
                              {group.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {CATEGORY_LABELS[group.category] || group.category}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Campanha */}
                      <td className="px-4 py-3">
                        {group.campaign_name ? (
                          <Badge variant="secondary" className="text-xs font-normal">
                            {group.campaign_name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* Ocupação */}
                      <td className="px-4 py-3">
                        <div className="space-y-1.5 min-w-[120px]">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium tabular-nums">
                              {group.participant_count}/{group.max_participants}
                            </span>
                            <span className="text-muted-foreground">{pct}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isFull
                                  ? "bg-failure"
                                  : pct > 80
                                    ? "bg-warning"
                                    : "bg-primary"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Leads identificados */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium tabular-nums">
                            {group.identified_leads}
                          </span>
                          {group.identified_leads > 0 && (
                            <CheckCircle2 className="size-3.5 text-success shrink-0" />
                          )}
                        </div>
                      </td>

                      {/* Não identificados */}
                      <td className="px-4 py-3">
                        {group.unidentified_count > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium tabular-nums text-warning">
                              {group.unidentified_count}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* Duplicados */}
                      <td className="px-4 py-3">
                        {group.duplicates > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium tabular-nums text-warning">
                              {group.duplicates}
                            </span>
                            <AlertTriangle className="size-3.5 text-warning shrink-0" />
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge kind={isFull ? "warning" : "success"}>
                          {isFull ? "Lotado" : "Ativo"}
                        </StatusBadge>
                      </td>

                      {/* Actions */}
                      <td className="px-2 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title="Ações" />}>
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleViewParticipants(group)}>
                              <Users className="size-4" />
                              Ver participantes
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleOpenAutomations(group)}>
                              <Zap className="size-4" />
                              Automações
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => router.push("/groups")}>
                              <MessageSquare className="size-4" />
                              Ver chat
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                toast.info("Buscando fotos dos participantes...");
                                try {
                                  const r = await backfillGroupParticipantAvatars(group.id);
                                  toast.success(`${r.processed} processados, ${r.updated} atualizados, ${r.failed} falhas`);
                                } catch (err: unknown) {
                                  toast.error((err as Error).message || "Erro ao buscar fotos");
                                }
                              }}
                            >
                              <ImageIcon className="size-4" />
                              Atualizar fotos
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => exportGroupCSV(group)}>
                              <Download className="size-4" />
                              Exportar dados
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          <div className="border-t px-4 py-2 flex items-center justify-between text-xs text-muted-foreground bg-muted/20">
            <span>
              {filtered.length} grupo{filtered.length !== 1 ? "s" : ""}
            </span>
            <span>
              {totalParticipants} participantes &middot;{" "}
              {filtered.reduce((a, g) => a + g.engaged_count, 0)} engajados &middot;{" "}
              {filtered.reduce((a, g) => a + g.recent_exits, 0)} saíram (7d)
            </span>
          </div>
        </div>
      )}

      {/* Create group dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar Grupo</DialogTitle>
            <DialogDescription>
              Cria um novo grupo no WhatsApp com link de convite automático.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Grupo</Label>
              <Input
                name="new-group-name"
                placeholder="Ex: Grupo VIP - Lançamento X"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={newCategory}
                onValueChange={(v) => setNewCategory(v ?? "geral")}
              >
                <SelectTrigger>
                  <SelectValue>
                    {CATEGORY_LABELS[newCategory] ?? "Selecione"}
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
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "Criando..." : "Criar Grupo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Automations dialog — Etapa 8 */}
      <Dialog open={automsOpen} onOpenChange={setAutomsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="size-4 text-primary" />
              Automações — {automsGroup?.name ?? "Grupo"}
            </DialogTitle>
            <DialogDescription>
              Ações automáticas disparadas quando eventos ocorrem no grupo.
            </DialogDescription>
          </DialogHeader>

          {automsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Existing automations */}
              {automs.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ativas</p>
                  <div className="divide-y divide-border/50 rounded-lg border overflow-hidden">
                    {automs.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                        <Zap className="size-3.5 shrink-0 text-primary" />
                        <div className="flex-1 min-w-0 text-sm">
                          <span className="font-medium">
                            {a.trigger === "member_joined" && "Ao entrar no grupo"}
                            {a.trigger === "member_left" && "Ao sair do grupo"}
                            {a.trigger === "lead_identified" && "Ao identificar lead"}
                            {a.trigger === "message_received" && "Ao receber mensagem"}
                          </span>
                          <span className="text-muted-foreground mx-1.5">→</span>
                          <span className="text-muted-foreground">
                            Adicionar tag:{" "}
                            {orgTags.find((t) => t.id === a.action_payload.tag_id)?.name ?? a.action_payload.tag_id}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="Remover"
                          disabled={deletingAutoId === a.id}
                          onClick={() => handleDeleteAutomation(a.id)}
                        >
                          {deletingAutoId === a.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5 text-destructive" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-3">
                  Nenhuma automação configurada ainda.
                </p>
              )}

              {/* Add new automation */}
              <div className="space-y-3 rounded-lg border p-4 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nova automação</p>
                <div className="space-y-2">
                  <Label className="text-xs">Quando</Label>
                  <Select
                    value={newAutoTrigger}
                    onValueChange={(v) => setNewAutoTrigger((v ?? "member_joined") as GroupAutomationTrigger)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member_joined">Ao entrar no grupo</SelectItem>
                      <SelectItem value="member_left">Ao sair do grupo</SelectItem>
                      <SelectItem value="lead_identified">Ao identificar lead</SelectItem>
                      <SelectItem value="message_received">Ao receber mensagem</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Ação — Adicionar tag</Label>
                  <Select
                    value={newAutoTagId}
                    onValueChange={(v) => setNewAutoTagId(v ?? "")}
                    onOpenChange={(open) => { if (open) loadTagsIfNeeded(); }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Escolher tag..." />
                    </SelectTrigger>
                    <SelectContent>
                      {orgTags.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          Nenhuma tag cadastrada
                        </div>
                      ) : (
                        orgTags.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            <span
                              className="inline-block size-2 rounded-full mr-1.5"
                              style={{ background: t.color }}
                            />
                            {t.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!newAutoTagId || newAutoSaving}
                  onClick={handleAddAutomation}
                >
                  {newAutoSaving ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Zap className="size-3.5 mr-1.5" />}
                  Adicionar automação
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Fechar</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={participantsOpen} onOpenChange={(o) => { setParticipantsOpen(o); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Participantes — {participantsGroup?.name ?? "Grupo"}</DialogTitle>
            <DialogDescription>
              {participants.length > 0 && (
                <>
                  {participants.length} total &middot;{" "}
                  {participants.filter((p) => p.lead).length} leads &middot;{" "}
                  {participants.filter((p) => !p.lead && p.identityKind === "phone").length} nao identificados &middot;{" "}
                  {participants.filter((p) => p.identityKind === "lid").length} sem telefone
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {participantsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : participantsError ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <AlertTriangle className="size-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{participantsError}</p>
              <Button size="sm" variant="outline" onClick={() => participantsGroup && handleViewParticipants(participantsGroup)}>
                Tentar novamente
              </Button>
            </div>
          ) : participants.length === 0 ? (
            <EmptyState
              variant="subtle"
              icon={<Users />}
              title="Nenhum participante retornado"
              description="Sincronize o grupo e tente novamente."
            />
          ) : (
            <div className="flex flex-col gap-3 overflow-hidden flex-1 min-h-0">
              <div className="flex items-center gap-2 shrink-0">
                <Input
                  name="participants-search"
                  placeholder="Buscar por nome, telefone ou JID..."
                  value={participantsSearch}
                  onChange={(e) => setParticipantsSearch(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs"
                  onClick={() => handleSelectAll(participants)}
                >
                  {participants.filter((p) => Boolean(p.lead) || p.identityKind === "phone").every((p) => selectedIds.has(p.id))
                    ? "Desmarcar todos"
                    : "Selecionar todos"}
                </Button>
              </div>
              <Tabs value={participantsTab} onValueChange={setParticipantsTab} className="flex flex-col overflow-hidden flex-1 min-h-0">
                <TabsList className="shrink-0">
                  <TabsTrigger value="todos">Todos ({participants.length})</TabsTrigger>
                  <TabsTrigger value="leads">Leads ({participants.filter((p) => p.lead).length})</TabsTrigger>
                  <TabsTrigger value="nao_id">Nao id. ({participants.filter((p) => !p.lead && p.identityKind === "phone").length})</TabsTrigger>
                  <TabsTrigger value="admins">Admins ({participants.filter((p) => p.isAdmin || p.isSuperAdmin).length})</TabsTrigger>
                </TabsList>
                {(["todos", "leads", "nao_id", "admins"] as const).map((tab) => {
                  const filtered = participants.filter((p) => {
                    if (tab === "leads") return Boolean(p.lead);
                    if (tab === "nao_id") return !p.lead && p.identityKind === "phone";
                    if (tab === "admins") return p.isAdmin || p.isSuperAdmin;
                    return true;
                  }).filter((p) => {
                    if (!participantsSearch.trim()) return true;
                    const q = participantsSearch.toLowerCase();
                    return (
                      p.lead?.name?.toLowerCase().includes(q) ||
                      p.phone?.includes(q) ||
                      p.rawJid.toLowerCase().includes(q)
                    );
                  });
                  return (
                    <TabsContent key={tab} value={tab} className="flex-1 overflow-y-auto min-h-0 mt-0">
                      {filtered.length === 0 ? (
                        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                          Nenhum resultado
                        </div>
                      ) : (
                        <div className="divide-y divide-border/40 rounded-lg border">
                          {filtered.map((p) => (
                            <ParticipantRow
                              key={p.id}
                              participant={p}
                              onOpenProfile={(leadId) => {
                                setParticipantsOpen(false);
                                router.push(`/crm?tab=leads&lead=${leadId}`);
                              }}
                              onOpenChat={handleOpenChat}
                              onCreateLead={handleCreateLead}
                              onToggleSelect={handleToggleSelect}
                              selected={selectedIds.has(p.id)}
                              chatLoading={chatLoadingLeadId === p.lead?.id}
                              createLoading={createLoadingJid === p.rawJid}
                            />
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            </div>
          )}

          <DialogFooter className="shrink-0 pt-2">
            {selectedIds.size > 0 ? (
              <div className="flex flex-1 items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground shrink-0">
                  {selectedIds.size} selecionado{selectedIds.size !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-2 flex-1 flex-wrap">
                  <Select
                    value={bulkTagId}
                    onValueChange={(v) => setBulkTagId(v ?? "")}
                    onOpenChange={(open) => { if (open) loadTagsIfNeeded(); }}
                  >
                    <SelectTrigger className="h-8 text-xs w-40">
                      <SelectValue placeholder="Escolher tag..." />
                    </SelectTrigger>
                    <SelectContent>
                      {orgTags.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          Nenhuma tag cadastrada
                        </div>
                      ) : (
                        orgTags.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            <span
                              className="inline-block size-2 rounded-full mr-1.5"
                              style={{ background: t.color }}
                            />
                            {t.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!bulkTagId || bulkLoading}
                    onClick={handleBulkAddTag}
                  >
                    {bulkLoading ? <Loader2 className="size-3 animate-spin" /> : <Tag className="size-3" />}
                    Aplicar tag
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => handleBulkExportCSV(participantsGroup?.name ?? "grupo")}
                  >
                    <Download className="size-3" />
                    Exportar CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs ml-auto"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Limpar seleção
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setParticipantsOpen(false)}>
                Fechar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
