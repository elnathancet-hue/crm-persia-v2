"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
  DialogDescription,
} from "@persia/ui/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@persia/ui/empty";
import { DataTable, type ColumnDef } from "@/components/shared/data-table";
import { LeadForm } from "@/components/leads/lead-form";
import {
  getLeads,
  createLead,
  getOrgTags,
  type LeadWithTags,
} from "@/actions/leads";
import {
  Plus,
  Search,
  Users,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
} from "lucide-react";
import { useRole } from "@/lib/hooks/use-role";
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

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
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

type LeadListProps = {
  initialLeads: LeadWithTags[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
};

type OrgTag = {
  id: string;
  name: string;
  color: string;
  organization_id: string;
  created_at: string;
};

export function LeadList({
  initialLeads,
  initialTotal,
  initialPage,
  initialTotalPages,
}: LeadListProps) {
  const router = useRouter();
  const { isAgent } = useRole(); // agent+ can create/edit/delete
  const [leads, setLeads] = React.useState(initialLeads);
  const [total, setTotal] = React.useState(initialTotal);
  const [page, setPage] = React.useState(initialPage);
  const [totalPages, setTotalPages] = React.useState(initialTotalPages);
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
        const result = await getLeads({
          search: params.search || undefined,
          status: params.status || undefined,
          tags: params.tags && params.tags.length > 0 ? params.tags : undefined,
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
    []
  );

  React.useEffect(() => {
    getOrgTags()
      .then((tags) => setOrgTags(tags as OrgTag[]))
      .catch(() => {
        setOrgTags([]);
      });
  }, []);

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
    fetchLeads({ search, status: statusFilter, tags: selectedTagIds, page: newPage });
  }

  async function handleCreate(formData: FormData) {
    await createLead(formData);
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

  const columns: ColumnDef<LeadWithTags>[] = [
    {
      key: "name",
      header: "Nome",
      sortable: true,
      render: (row) => (
        <span className="font-medium text-sm">{row.name || "Sem nome"}</span>
      ),
    },
    {
      key: "phone",
      header: "Telefone",
      render: (row) => <span className="text-sm">{row.phone || "-"}</span>,
    },
    {
      key: "email",
      header: "E-mail",
      render: (row) => <span className="text-sm">{row.email || "-"}</span>,
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
        return <Badge variant={s.variant} className="rounded-full px-3 py-1 text-xs">{s.label}</Badge>;
      },
    },
    {
      key: "source",
      header: "Origem",
      sortable: true,
      render: (row) => (
        <span className="text-sm capitalize">{row.source}</span>
      ),
    },
    {
      key: "tags",
      header: "Tags",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.lead_tags?.map((lt) => (
            <Badge
              key={lt.tag_id}
              variant="secondary"
              className="rounded-full text-xs px-2 py-0.5"
              style={{
                backgroundColor: lt.tags?.color ? `${lt.tags.color}20` : undefined,
                color: lt.tags?.color || undefined,
              }}
            >
              {lt.tags?.name}
            </Badge>
          ))}
          {(!row.lead_tags || row.lead_tags.length === 0) && (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </div>
      ),
    },
    {
      key: "last_interaction_at",
      header: "Última interação",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-muted-foreground">
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
              <Button variant="ghost" size="icon-xs" aria-label="Mais opções" />
            }
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/leads/${row.id}`);
              }}
            >
              <Eye className="size-4" />
              Ver detalhes
            </DropdownMenuItem>
            {isAgent && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/leads/${row.id}`);
                  }}
                >
                  <Pencil className="size-4" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/leads/${row.id}`);
                  }}
                >
                  <Trash2 className="size-4" />
                  Excluir
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} {total === 1 ? "lead" : "leads"} encontrados
          </p>
        </div>
        {isAgent && (
          <Button onClick={() => setIsCreateOpen(true)} className="h-9 rounded-md">
            <Plus className="size-4" data-icon="inline-start" />
            Novo Lead
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou e-mail..."
            className="pl-9 h-10 rounded-md"
            value={search}
            onChange={(e) =>
              handleSearchChange((e.target as HTMLInputElement).value)
            }
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-10 rounded-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orgTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {orgTags.map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => handleTagToggle(tag.id)}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active ? "border-transparent" : "border-border hover:bg-muted"
                }`}
                style={
                  active
                    ? {
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }
                    : undefined
                }
              >
                {tag.name}
              </button>
            );
          })}
          {selectedTagIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setSelectedTagIds([]);
                fetchLeads({ search, status: statusFilter, tags: [], page: 1 });
              }}
            >
              Limpar tags
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      <Card className={`border rounded-xl ${isLoading ? "opacity-60 transition-opacity" : ""}`}>
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
            {!search && statusFilter === "all" && isAgent && (
              <Button onClick={() => setIsCreateOpen(true)} className="rounded-md">
                <Plus className="size-4" data-icon="inline-start" />
                Novo Lead
              </Button>
            )}
          </Empty>
        ) : (
          <DataTable
            columns={columns}
            data={leads}
            onRowClick={(row) => router.push(`/leads/${row.id}`)}
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
                onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                aria-disabled={page >= totalPages}
                className={
                  page >= totalPages ? "pointer-events-none opacity-50" : ""
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Novo Lead</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Preencha os dados do novo lead.
            </DialogDescription>
          </DialogHeader>
          <LeadForm
            onSubmit={handleCreate}
            onCancel={() => setIsCreateOpen(false)}
            submitLabel="Criar Lead"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
