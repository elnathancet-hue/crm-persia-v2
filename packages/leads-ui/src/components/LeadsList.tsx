"use client";

// LeadsList — view de listagem compartilhada entre CRM (cliente) e Admin
// (superadmin). Auth, hooks de role e roteamento ficam nos apps. O pacote
// recebe:
//   - dados iniciais (initialLeads/Total/Page/TotalPages) via props
//   - permissoes (canEdit) via props
//   - actions (listLeads/createLead/getOrgTags) via <LeadsProvider>
//   - callbacks (onRowClick, onEditLead, onDeleteLead) — cada app
//     decide o que rolar (drawer in-place, navegar pra detalhe, dialog)
//
// Originalmente em apps/crm/src/components/leads/lead-list.tsx (~540
// linhas). Extraido pra resolver drift visual entre os 2 apps (admin
// estava com UI legada custom-CSS).

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Card } from "@persia/ui/card";
import { Checkbox } from "@persia/ui/checkbox";
import { RelativeTime, formatRelativeShortPtBR } from "@persia/ui";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@persia/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import { DialogHero } from "@persia/ui/dialog-hero";
import { EmptyState } from "@persia/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@persia/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@persia/ui/pagination";
import {
  Plus,
  Search,
  Users,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  Briefcase,
  MessageCircle,
  CalendarPlus,
  ChevronDown,
  Check,
  Activity as ActivityIcon,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  X,
  UserCog,
  Loader2,
} from "lucide-react";
import type { LeadWithTags } from "@persia/shared/crm";

import { DataTable, type ColumnDef } from "./DataTable";
import { LeadForm } from "./LeadForm";
import { useLeadsActions } from "../context";
import type { OrgTag } from "../actions";

const STATUS_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  new: { label: "Novo", variant: "default" },
  contacted: { label: "Contactado", variant: "secondary" },
  qualified: { label: "Qualificado", variant: "outline" },
  customer: { label: "Cliente", variant: "default" },
  lost: { label: "Perdido", variant: "destructive" },
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Todos os status" },
  { value: "new", label: "Novo" },
  { value: "contacted", label: "Contactado" },
  { value: "qualified", label: "Qualificado" },
  { value: "customer", label: "Cliente" },
  { value: "lost", label: "Perdido" },
];

// Calcula cor de texto (branco/escuro) baseado na luminance da cor de fundo
function getContrastTextColor(hex: string | null | undefined): string {
  const c = (hex || "#6366f1").replace("#", "");
  if (c.length !== 6) return "#ffffff";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1A1A1A" : "#FFFFFF";
}

// PR-L3: helpers locais pra render das colunas enriquecidas
function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function truncateText(s: string | null, max: number): string {
  if (!s) return "—";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * PR-L3: stats enriquecidas por linha.
 * Shape espelha LeadListItemStats em apps/crm/src/actions/leads.ts.
 * Definido aqui pra evitar dependencia cruzada (packages/leads-ui
 * nao importa de apps/crm — regra de monorepo).
 */
export interface LeadListItemStatsShape {
  deals: {
    open_count: number;
    open_total_value: number;
    latest_open_stage: { id: string; name: string; color: string } | null;
  };
  activities: {
    count: number;
    latest_description: string | null;
  };
  conversations: {
    count: number;
    last_message_at: string | null;
  };
}

export interface LeadsListProps {
  initialLeads: LeadWithTags[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  /** agent+: pode criar lead. Default false. */
  canEdit: boolean;
  /** Click numa linha (CRM abre drawer; admin navega pra detalhe). */
  onRowClick?: (lead: LeadWithTags) => void;
  /** Click em "Editar" (default = onRowClick). Caller decide. */
  onEditLead?: (lead: LeadWithTags) => void;
  /** Click em "Excluir" — caller confirma + deleta. */
  onDeleteLead?: (lead: LeadWithTags) => void;
  /** Slots opcionais no header (ex: botao Importar, Exportar). Renderizam
   *  ANTES do botao "Novo Lead". Cada app decide o que injetar. */
  headerActions?: React.ReactNode;
  /**
   * PR-L3: stats enriquecidas pra colunas extras (Negocios/Etapa/
   * Atividades). Map<leadId, stats>. Opcional — se nao vier, colunas
   * extras nao renderizam (degrada graciosamente, admin compat).
   */
  initialStats?: Map<string, LeadListItemStatsShape>;
  /**
   * PR-L3: lista de membros pra dropdown "Atribuir responsavel"
   * inline. Vazio = coluna Responsavel renderiza read-only (so nome
   * do assignee atual).
   */
  assignees?: { id: string; name: string }[];
  /** PR-L3: callback de atribuir lead via dropdown inline. */
  onAssignLead?: (leadId: string, userId: string | null) => Promise<void>;
  /** PR-L3: callback "+ Negocio" no menu ⋯ */
  onCreateDeal?: (lead: LeadWithTags) => void;
  /** PR-L3: callback "Abrir conversa" no menu ⋯ */
  onOpenConversation?: (lead: LeadWithTags) => void;
  /** PR-L3: callback "Agendar" no menu ⋯ */
  onScheduleAppointment?: (lead: LeadWithTags) => void;
  /**
   * PR-L4: callback bulk delete. Recebe lista de leadIds. Caller e
   * responsavel pela confirmacao (UI ja faz AlertDialog antes de
   * chamar). Retorna count atualizado.
   */
  onBulkDelete?: (leadIds: string[]) => Promise<{ deleted_count: number }>;
  /**
   * PR-L4: callback bulk assign. userId=null = desatribui todos.
   */
  onBulkAssign?: (
    leadIds: string[],
    userId: string | null,
  ) => Promise<{ updated_count: number }>;
}

export function LeadsList({
  initialLeads,
  initialTotal,
  initialPage,
  initialTotalPages,
  canEdit,
  onRowClick,
  onEditLead,
  onDeleteLead,
  headerActions,
  initialStats,
  assignees = [],
  onAssignLead,
  onCreateDeal,
  onOpenConversation,
  onScheduleAppointment,
  onBulkDelete,
  onBulkAssign,
}: LeadsListProps) {
  const actions = useLeadsActions();
  const [leads, setLeads] = React.useState(initialLeads);
  const [total, setTotal] = React.useState(initialTotal);
  const [page, setPage] = React.useState(initialPage);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);

  // Sync state quando o pai re-fetcha (ex.: router.refresh() depois de
  // um drawer salvar). Sem isso, atualizacoes externas de uma row nao
  // aparecem ate o usuario trocar de filtro/pagina.
  React.useEffect(() => {
    setLeads(initialLeads);
    setTotal(initialTotal);
    setPage(initialPage);
    setTotalPages(initialTotalPages);
  }, [initialLeads, initialTotal, initialPage, initialTotalPages]);

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [orgTags, setOrgTags] = React.useState<OrgTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  // PR-L4: bulk select state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = React.useState(false);
  const [bulkPending, setBulkPending] = React.useState(false);

  // PR-L4: sort state. Default created_at DESC.
  type SortColumn =
    | "created_at"
    | "name"
    | "last_interaction_at"
    | "updated_at";
  const [sortColumn, setSortColumn] =
    React.useState<SortColumn>("created_at");
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">(
    "desc",
  );

  // Limpa selecao quando dados mudam (refresh / page change)
  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [leads]);

  const fetchLeads = React.useCallback(
    async (params: {
      search?: string;
      status?: string;
      tags?: string[];
      page?: number;
      orderColumn?: SortColumn;
      orderDirection?: "asc" | "desc";
    }) => {
      setIsLoading(true);
      try {
        const result = await actions.listLeads({
          search: params.search || undefined,
          status: params.status || undefined,
          tags:
            params.tags && params.tags.length > 0 ? params.tags : undefined,
          page: params.page || 1,
          limit: 20,
          // PR-L4: orderBy opcional
          ...(params.orderColumn
            ? {
                orderBy: {
                  column: params.orderColumn,
                  direction: params.orderDirection ?? "desc",
                },
              }
            : {}),
        });
        setLeads(result.leads);
        setTotal(result.total);
        setPage(result.page);
        setTotalPages(result.totalPages);
      } catch {
        // silently handle
      } finally {
        setIsLoading(false);
      }
    },
    [actions],
  );

  React.useEffect(() => {
    actions
      .getOrgTags()
      .then((tags) => setOrgTags(tags))
      .catch(() => setOrgTags([]));
  }, [actions]);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchLeads({
        search: value,
        status: statusFilter,
        tags: selectedTagIds,
        page: 1,
      });
    }, 400);
  }

  function handleStatusChange(value: string | null) {
    if (!value) return;
    setStatusFilter(value);
    fetchLeads({ search, status: value, tags: selectedTagIds, page: 1 });
  }

  function handleTagToggle(tagId: string) {
    const nextTags = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];

    setSelectedTagIds(nextTags);
    fetchLeads({
      search,
      status: statusFilter,
      tags: nextTags,
      page: 1,
    });
  }

  function handlePageChange(newPage: number) {
    fetchLeads({
      search,
      status: statusFilter,
      tags: selectedTagIds,
      page: newPage,
      orderColumn: sortColumn,
      orderDirection: sortDirection,
    });
  }

  // PR-L4: handler de click em sortable header. Toggle direction se
  // mesma coluna; senao, set nova coluna com default DESC.
  function handleSortClick(column: SortColumn) {
    let nextDirection: "asc" | "desc";
    if (sortColumn === column) {
      nextDirection = sortDirection === "desc" ? "asc" : "desc";
    } else {
      nextDirection = "desc";
    }
    setSortColumn(column);
    setSortDirection(nextDirection);
    fetchLeads({
      search,
      status: statusFilter,
      tags: selectedTagIds,
      page: 1,
      orderColumn: column,
      orderDirection: nextDirection,
    });
  }

  // PR-L4: bulk select handlers
  function toggleSelected(leadId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (prev.size === leads.length) return new Set();
      return new Set(leads.map((l) => l.id));
    });
  }

  function clearSelected() {
    setSelectedIds(new Set());
  }

  async function handleCreate(formData: FormData) {
    await actions.createLead(formData);
    setIsCreateOpen(false);
    fetchLeads({ search, status: statusFilter, tags: selectedTagIds, page });
  }

  // Sprint 3c: formatDate local removido. Coluna "Ultima interacao"
  // agora usa <RelativeTime />, que mostra absoluto no SSR e troca pro
  // relativo curto ("3h", "5d") apos hydration. Resolve React #418.

  const handleEdit = onEditLead ?? onRowClick;

  // PR-L4: helper pra renderizar cabecalho sortable com seta visual.
  // Click no header chama handleSortClick(column).
  const renderSortHeader = (column: SortColumn, label: string) => {
    const isActive = sortColumn === column;
    const Icon = isActive
      ? sortDirection === "desc"
        ? ArrowDown
        : ArrowUp
      : ArrowUpDown;
    return (
      <button
        type="button"
        onClick={() => handleSortClick(column)}
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider hover:text-primary transition-colors"
      >
        {label}
        <Icon
          className={`size-3 ${isActive ? "text-primary" : "text-muted-foreground/50"}`}
          aria-hidden
        />
      </button>
    );
  };

  // PR-L4: bulk operations enabled? (admin compat — admin nao passa
  // callbacks por default).
  const bulkEnabled = canEdit && (!!onBulkDelete || !!onBulkAssign);
  const allSelected =
    selectedIds.size > 0 && selectedIds.size === leads.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const columns: ColumnDef<LeadWithTags>[] = [
    // PR-L4: coluna checkbox bulk select (so renderiza se bulk habilitado)
    ...(bulkEnabled
      ? ([
          {
            key: "_select",
            header: (
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={toggleSelectAll}
                aria-label="Selecionar todos"
                onClick={(e) => e.stopPropagation()}
              />
            ) as React.ReactNode,
            className: "w-10",
            render: (row: LeadWithTags) => (
              <Checkbox
                checked={selectedIds.has(row.id)}
                onCheckedChange={() => toggleSelected(row.id)}
                aria-label={`Selecionar ${row.name ?? "lead"}`}
                onClick={(e) => e.stopPropagation()}
              />
            ),
          },
        ] as ColumnDef<LeadWithTags>[])
      : []),
    {
      key: "name",
      header: renderSortHeader("name", "Nome"),
      sortable: true,
      render: (row) => {
        const name = row.name?.trim() || "Sem nome";
        const initials = name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0])
          .join("")
          .toUpperCase();
        // Hash → cor saturada (8 paletas) — mesmo padrao do KanbanBoard
        const palette = [
          "bg-blue-500",
          "bg-emerald-500",
          "bg-amber-500",
          "bg-rose-500",
          "bg-violet-500",
          "bg-cyan-500",
          "bg-orange-500",
          "bg-pink-500",
        ];
        const seed = name
          .split("")
          .reduce((a, c) => a + c.charCodeAt(0), 0);
        const avatarColor = palette[seed % palette.length];
        return (
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm ${avatarColor}`}
              aria-hidden
            >
              {initials || "?"}
            </span>
            <span className="font-semibold text-sm text-foreground">{name}</span>
          </div>
        );
      },
    },
    {
      key: "phone",
      header: "Telefone",
      render: (row) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {row.phone || "—"}
        </span>
      ),
    },
    {
      key: "email",
      header: "E-mail",
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.email || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => {
        const s = STATUS_MAP[row.status] ?? {
          label: row.status,
          variant: "outline" as const,
        };
        // Bullet de cor baseado no status (visual mais consistente)
        const dotColor =
          row.status === "new"
            ? "bg-blue-500"
            : row.status === "contacted"
              ? "bg-amber-500"
              : row.status === "qualified"
                ? "bg-violet-500"
                : row.status === "customer"
                  ? "bg-emerald-500"
                  : row.status === "lost"
                    ? "bg-red-500"
                    : "bg-muted-foreground";
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium">
            <span
              className={`inline-block size-1.5 rounded-full ${dotColor}`}
              aria-hidden
            />
            {s.label}
          </span>
        );
      },
    },
    {
      key: "source",
      header: "Origem",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground capitalize">
          {row.source}
        </span>
      ),
    },
    {
      key: "tags",
      header: "Tags",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.lead_tags?.slice(0, 3).map((lt) => (
            <span
              key={lt.tag_id}
              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm"
              style={{
                backgroundColor: lt.tags?.color || "#6366f1",
                color: getContrastTextColor(lt.tags?.color),
              }}
            >
              {lt.tags?.name}
            </span>
          ))}
          {row.lead_tags && row.lead_tags.length > 3 && (
            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              +{row.lead_tags.length - 3}
            </span>
          )}
          {(!row.lead_tags || row.lead_tags.length === 0) && (
            <span className="text-xs text-muted-foreground/60">—</span>
          )}
        </div>
      ),
    },
    {
      key: "last_interaction_at",
      header: renderSortHeader("last_interaction_at", "Última interação"),
      sortable: true,
      render: (row) => (
        <RelativeTime
          iso={row.last_interaction_at}
          formatter={formatRelativeShortPtBR}
          className="text-xs text-muted-foreground tabular-nums"
          emptyText="-"
        />
      ),
    },
    // ==================== PR-L3: 4 colunas enriquecidas ====================
    // Renderizam quando initialStats existe; degradam graciosamente quando
    // nao (admin compat). Ocultas em mobile (md:table-cell) pra nao poluir.
    ...(initialStats
      ? ([
          {
            key: "responsavel",
            header: "Responsável",
            className: "hidden lg:table-cell",
            render: (row: LeadWithTags) => {
              // PR-L3: dropdown inline pra atribuir. Reusa pattern do PR-C card.
              const currentAssigneeId = row.assigned_to ?? null;
              const currentAssignee =
                currentAssigneeId
                  ? assignees.find((a) => a.id === currentAssigneeId)
                  : null;
              const canAssign =
                canEdit && !!onAssignLead && assignees.length > 0;

              if (!canAssign) {
                return (
                  <span className="text-xs text-muted-foreground">
                    {currentAssignee?.name || "—"}
                  </span>
                );
              }

              return (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-muted text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      />
                    }
                  >
                    <span
                      className={
                        currentAssignee
                          ? "text-foreground"
                          : "text-muted-foreground/70"
                      }
                    >
                      {currentAssignee?.name || "Sem responsável"}
                    </span>
                    <ChevronDown
                      className="size-3 shrink-0 opacity-60"
                      aria-hidden
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-56"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {assignees.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!onAssignLead) return;
                          await onAssignLead(row.id, m.id);
                        }}
                      >
                        {m.name}
                        {currentAssigneeId === m.id && (
                          <Check className="ml-auto size-3.5" />
                        )}
                      </DropdownMenuItem>
                    ))}
                    {currentAssigneeId && (
                      <DropdownMenuItem
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!onAssignLead) return;
                          await onAssignLead(row.id, null);
                        }}
                        className="text-muted-foreground"
                      >
                        Sem responsável
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          },
          {
            key: "negocios",
            header: "Negócios",
            className: "hidden md:table-cell",
            render: (row: LeadWithTags) => {
              const stats = initialStats.get(row.id);
              if (!stats || stats.deals.open_count === 0) {
                return <span className="text-xs text-muted-foreground/60">—</span>;
              }
              return (
                <div className="flex flex-col gap-0.5">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground tabular-nums">
                    <Briefcase className="size-3 text-muted-foreground" />
                    {stats.deals.open_count}
                  </span>
                  {stats.deals.open_total_value > 0 && (
                    <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                      R$ {formatBRL(stats.deals.open_total_value)}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            key: "etapa",
            header: "Etapa atual",
            className: "hidden xl:table-cell",
            render: (row: LeadWithTags) => {
              const stats = initialStats.get(row.id);
              const stage = stats?.deals.latest_open_stage;
              if (!stage) {
                return <span className="text-xs text-muted-foreground/60">—</span>;
              }
              return (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: `${stage.color}20`,
                    color: stage.color,
                  }}
                  title={`Etapa do negócio aberto mais recente: ${stage.name}`}
                >
                  <span
                    className="inline-block size-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden
                  />
                  {stage.name}
                </span>
              );
            },
          },
          {
            key: "atividades",
            header: "Atividades",
            className: "hidden xl:table-cell",
            render: (row: LeadWithTags) => {
              const stats = initialStats.get(row.id);
              if (!stats || stats.activities.count === 0) {
                return <span className="text-xs text-muted-foreground/60">—</span>;
              }
              return (
                <div className="flex flex-col gap-0.5 max-w-[180px]">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground tabular-nums">
                    <ActivityIcon className="size-3 text-violet-600" />
                    {stats.activities.count}
                  </span>
                  {stats.activities.latest_description && (
                    <span
                      className="text-[10px] text-muted-foreground truncate"
                      title={stats.activities.latest_description}
                    >
                      {truncateText(stats.activities.latest_description, 32)}
                    </span>
                  )}
                </div>
              );
            },
          },
        ] as ColumnDef<LeadWithTags>[])
      : []),
    {
      key: "actions",
      header: "",
      className: "w-10",
      render: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Mais opções"
                className="text-muted-foreground hover:bg-muted hover:text-foreground"
              />
            }
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRowClick && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onRowClick(row);
                }}
              >
                <Eye className="size-4" />
                Ver detalhes
              </DropdownMenuItem>
            )}
            {/* PR-L3: 3 CTAs novos por linha — operacionais (atendimento) */}
            {canEdit && onCreateDeal && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateDeal(row);
                }}
              >
                <Briefcase className="size-4" />
                Novo negócio
              </DropdownMenuItem>
            )}
            {canEdit && onOpenConversation && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenConversation(row);
                }}
              >
                <MessageCircle className="size-4" />
                Abrir conversa
              </DropdownMenuItem>
            )}
            {canEdit && onScheduleAppointment && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onScheduleAppointment(row);
                }}
              >
                <CalendarPlus className="size-4" />
                Agendar
              </DropdownMenuItem>
            )}
            {canEdit && handleEdit && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleEdit(row);
                }}
              >
                <Pencil className="size-4" />
                Editar
              </DropdownMenuItem>
            )}
            {canEdit && onDeleteLead && (
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteLead(row);
                }}
              >
                <Trash2 className="size-4" />
                Excluir
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const activeFilterCount =
    (search ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    selectedTagIds.length;

  return (
    <div className="flex flex-col gap-5">
      {/* Header — titulo + contador + acoes alinhadas */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/20">
            <Users className="size-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground font-heading leading-none">
              Leads
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {total.toLocaleString("pt-BR")}
              </span>{" "}
              {total === 1 ? "lead encontrado" : "leads encontrados"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* headerActions vem do app: Importar + Exportar (secundarios) */}
          {headerActions}
          {canEdit && (
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="h-9 rounded-md shadow-sm"
            >
              <Plus className="size-4" data-icon="inline-start" />
              Novo lead
            </Button>
          )}
        </div>
      </div>

      {/* Filters bar — busca + select status agrupados */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou e-mail..."
            className="h-10 rounded-md pl-9"
            value={search}
            onChange={(e) =>
              handleSearchChange((e.target as HTMLInputElement).value)
            }
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger
            className={`h-10 w-44 rounded-md ${
              statusFilter !== "all"
                ? "border-primary/40 bg-primary/5 text-primary"
                : ""
            }`}
          >
            <SelectValue>
              {STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)
                ?.label ?? "Status"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-md text-xs"
            onClick={() => {
              setSelectedTagIds([]);
              setSearch("");
              setStatusFilter("all");
              fetchLeads({
                search: "",
                status: "all",
                tags: [],
                page: 1,
              });
            }}
          >
            Limpar filtros ({activeFilterCount})
          </Button>
        )}
      </div>

      {/* Tags chips — só renderiza se tem tags */}
      {orgTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
            Etiquetas:
          </span>
          {orgTags.map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleTagToggle(tag.id)}
                aria-pressed={active}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                  active
                    ? "border-transparent shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                style={
                  active
                    ? {
                        backgroundColor: tag.color,
                        color: getContrastTextColor(tag.color),
                      }
                    : undefined
                }
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      {/* PR-L4: Bulk action bar — aparece quando ha selecao.
          Sticky no topo da tabela, mostra count + acoes (Atribuir,
          Excluir, Limpar). */}
      {bulkEnabled && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold text-primary tabular-nums">
              {selectedIds.size} lead{selectedIds.size === 1 ? "" : "s"}{" "}
              selecionado{selectedIds.size === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={clearSelected}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              disabled={bulkPending}
            >
              Limpar
            </button>
          </div>
          <div className="flex items-center gap-2">
            {onBulkAssign && assignees.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-md gap-1.5"
                onClick={() => setBulkAssignOpen(true)}
                disabled={bulkPending}
              >
                <UserCog className="size-3.5" />
                Atribuir
              </Button>
            )}
            {onBulkDelete && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-md gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkPending}
              >
                {bulkPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Excluir
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Content — overflow-x-auto pra tabela em telas estreitas
          PR-L4: skeleton durante loading (em vez de opacity-60) */}
      <Card
        className={`border border-border/60 rounded-xl shadow-sm overflow-hidden ${
          isLoading ? "opacity-70" : ""
        }`}
      >
        {leads.length === 0 ? (
          <EmptyState
            variant="subtle"
            icon={<Users />}
            title="Nenhum lead encontrado"
            description={
              search || statusFilter !== "all" || selectedTagIds.length > 0
                ? "Tente ajustar os filtros de busca."
                : "Cadastre seu primeiro lead para começar."
            }
            action={
              !search &&
              statusFilter === "all" &&
              selectedTagIds.length === 0 &&
              canEdit ? (
                <Button
                  onClick={() => setIsCreateOpen(true)}
                  className="rounded-md"
                >
                  <Plus className="size-4" data-icon="inline-start" />
                  Novo lead
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
          <DataTable
            columns={columns}
            data={leads}
            onRowClick={onRowClick}
          />
          </div>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                text="Anterior"
                onClick={() => handlePageChange(Math.max(1, page - 1))}
                aria-disabled={page <= 1}
                className={page <= 1 ? "pointer-events-none opacity-50" : ""}
              />
            </PaginationItem>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    isActive={pageNum === page}
                    onClick={() => handlePageChange(pageNum)}
                  >
                    {pageNum}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
            <PaginationItem>
              <PaginationNext
                text="Proximo"
                onClick={() =>
                  handlePageChange(Math.min(totalPages, page + 1))
                }
                aria-disabled={page >= totalPages}
                className={
                  page >= totalPages
                    ? "pointer-events-none opacity-50"
                    : ""
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border bg-card p-5">
            <DialogTitle className="sr-only">Novo lead</DialogTitle>
            <DialogHero
              icon={<Plus className="size-5" />}
              title="Novo lead"
              tagline="Preencha os dados abaixo"
            />
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-5">
            <LeadForm
              onSubmit={handleCreate}
              onCancel={() => setIsCreateOpen(false)}
              submitLabel="Criar lead"
              // PR-L5: ao detectar duplicidade, fecha o form e abre
              // o drawer do lead existente. Tenta encontrar em
              // `leads` (state local — pagina atual). Se nao achar
              // (lead em outra pagina/filtro), apenas fecha o form
              // — caller pode wireia `onOpenLeadById` no futuro pra
              // ir buscar.
              onDuplicateFound={(match) => {
                setIsCreateOpen(false);
                const existing = leads.find((l) => l.id === match.id);
                if (existing && onRowClick) {
                  onRowClick(existing);
                }
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* PR-L4: AlertDialog confirmar bulk delete (defesa contra
          excluir lista inteira por engano) */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir {selectedIds.size} lead{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Os leads selecionados e todos os dados vinculados (negócios,
              conversas, atividades, tags) serão removidos permanentemente.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!onBulkDelete) return;
                setBulkPending(true);
                try {
                  const ids = Array.from(selectedIds);
                  const result = await onBulkDelete(ids);
                  toast.success(
                    `${result.deleted_count} lead${result.deleted_count === 1 ? "" : "s"} excluído${result.deleted_count === 1 ? "" : "s"}`,
                  );
                  setSelectedIds(new Set());
                  setBulkDeleteOpen(false);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Erro ao excluir",
                  );
                } finally {
                  setBulkPending(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* PR-L4: Dialog escolher responsavel pra bulk assign */}
      <Dialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
        <DialogContent className="rounded-2xl w-[92vw] sm:max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Atribuir {selectedIds.size} lead
              {selectedIds.size === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 py-2 max-h-80 overflow-y-auto">
            {assignees.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={bulkPending}
                onClick={async () => {
                  if (!onBulkAssign) return;
                  setBulkPending(true);
                  try {
                    const ids = Array.from(selectedIds);
                    const result = await onBulkAssign(ids, m.id);
                    toast.success(
                      `${result.updated_count} lead${result.updated_count === 1 ? "" : "s"} atribuído${result.updated_count === 1 ? "" : "s"} a ${m.name}`,
                    );
                    setSelectedIds(new Set());
                    setBulkAssignOpen(false);
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Erro ao atribuir",
                    );
                  } finally {
                    setBulkPending(false);
                  }
                }}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span>{m.name}</span>
              </button>
            ))}
            {assignees.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">
                Nenhum membro disponível para atribuir.
              </p>
            ) : (
              <button
                type="button"
                disabled={bulkPending}
                onClick={async () => {
                  if (!onBulkAssign) return;
                  setBulkPending(true);
                  try {
                    const ids = Array.from(selectedIds);
                    const result = await onBulkAssign(ids, null);
                    toast.success(
                      `${result.updated_count} lead${result.updated_count === 1 ? "" : "s"} sem responsável`,
                    );
                    setSelectedIds(new Set());
                    setBulkAssignOpen(false);
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Erro ao remover",
                    );
                  } finally {
                    setBulkPending(false);
                  }
                }}
                className="mt-2 flex w-full items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <X className="size-3.5" />
                Sem responsável
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
