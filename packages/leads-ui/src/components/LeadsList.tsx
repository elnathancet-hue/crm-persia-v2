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
import { Badge } from "@persia/ui/badge";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Card } from "@persia/ui/card";
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
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@persia/ui/empty";
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

  const fetchLeads = React.useCallback(
    async (params: {
      search?: string;
      status?: string;
      tags?: string[];
      page?: number;
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
    });
  }

  async function handleCreate(formData: FormData) {
    await actions.createLead(formData);
    setIsCreateOpen(false);
    fetchLeads({ search, status: statusFilter, tags: selectedTagIds, page });
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const handleEdit = onEditLead ?? onRowClick;

  const columns: ColumnDef<LeadWithTags>[] = [
    {
      key: "name",
      header: "Nome",
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
      header: "Última interação",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDate(row.last_interaction_at)}
        </span>
      ),
    },
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

      {/* Content */}
      <Card
        className={`border border-border/60 rounded-xl shadow-sm overflow-hidden ${
          isLoading ? "opacity-60 transition-opacity" : ""
        }`}
      >
        {leads.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>Nenhum lead encontrado</EmptyTitle>
              <EmptyDescription>
                {search || statusFilter !== "all"
                  ? "Tente ajustar os filtros de busca."
                  : "Cadastre seu primeiro lead para comecar."}
              </EmptyDescription>
            </EmptyHeader>
            {!search && statusFilter === "all" && canEdit && (
              <Button
                onClick={() => setIsCreateOpen(true)}
                className="rounded-md"
              >
                <Plus className="size-4" data-icon="inline-start" />
                Novo Lead
              </Button>
            )}
          </Empty>
        ) : (
          <DataTable
            columns={columns}
            data={leads}
            onRowClick={onRowClick}
          />
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
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
