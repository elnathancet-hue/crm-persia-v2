"use client";

// Dialog "Exportar leads" centralizado com filtros + preview + selector
// de colunas + paginação automática.
//
// Por que existe: o ExportMenu antigo (popover simples) só baixava a
// página atual (~20 leads). Cliente com 500 leads ficava travado. Esta
// versão:
//   - Aceita filtros (data, status, tags, responsável, origem, etc)
//   - Mostra preview ao vivo (count atualiza ao mudar filtro)
//   - Pagina internamente: chunks de 1000 leads via fetchLeadsForExport
//   - Permite escolher quais colunas exportar
//   - Formato Excel (.xlsx) ou CSV
//
// Briefing produto: "boa interatividade do usuário".
//   - Preview count atualiza com debounce 400ms (sem flicker)
//   - Atalhos rápidos pros 90% dos casos via LeadsAdvancedFilters
//   - Feedback claro: pending / sucesso / erro
//   - Cap defensivo de 100k leads (improvável atingir)

import * as React from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import { Checkbox } from "@persia/ui/checkbox";
import { Label } from "@persia/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@persia/ui/dialog";
import {
  LeadsAdvancedFilters,
  type LeadsAdvancedFiltersValue,
} from "./LeadsAdvancedFilters";
import type { LeadWithTags } from "@persia/shared/crm";

/**
 * Definição de coluna disponível no Dialog. Cada coluna tem:
 *   - key: id estável
 *   - label: texto user-facing
 *   - accessor: extrai valor de um lead (string/Date/number)
 *   - default: vem marcada por padrão?
 */
export interface ExportLeadColumn {
  key: string;
  label: string;
  accessor: (lead: LeadWithTags) => string | number | Date | null;
  default?: boolean;
}

export interface ExportLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filtros já aplicados na lista (pre-seleciona o dialog). */
  initialFilters: LeadsAdvancedFiltersValue;
  /**
   * Conta quantos leads bateriam nos filtros (usado pra preview).
   * Recebe os filtros completos (avançados + status/tags/etc).
   */
  countLeads: (filters: LeadsAdvancedFiltersValue & { search?: string; status?: string; tags?: string[] }) => Promise<number>;
  /**
   * Busca todos os leads que batem (em chunks de 1000 internos).
   * Retorna array completo pra serializar como CSV/XLSX no client.
   */
  fetchAllLeads: (filters: LeadsAdvancedFiltersValue & { search?: string; status?: string; tags?: string[] }) => Promise<LeadWithTags[]>;
  /** Função que gera o download (CSV ou XLSX) — vem do @persia/crm-ui. */
  onDownload: (
    rows: LeadWithTags[],
    columns: ExportLeadColumn[],
    format: "csv" | "xlsx",
  ) => { ok: boolean; reason?: string };
  /** Lista de responsaveis pra <LeadsAdvancedFilters>. */
  assignees: { id: string; name: string }[];
  /** Origens conhecidas. */
  sources: string[];
  /** Filtros base não-avançados (search/status/tags) — herdados da lista. */
  baseFilters?: { search?: string; status?: string; tags?: string[] };
  /** Definição das colunas disponíveis pra escolher. */
  availableColumns: ExportLeadColumn[];
}

export function ExportLeadsDialog({
  open,
  onOpenChange,
  initialFilters,
  countLeads,
  fetchAllLeads,
  onDownload,
  assignees,
  sources,
  baseFilters = {},
  availableColumns,
}: ExportLeadsDialogProps) {
  const [filters, setFilters] = React.useState<LeadsAdvancedFiltersValue>(initialFilters);
  const [previewCount, setPreviewCount] = React.useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(
    () =>
      new Set(
        availableColumns.filter((c) => c.default !== false).map((c) => c.key),
      ),
  );

  // Re-sincroniza filters quando o dialog reabre
  React.useEffect(() => {
    if (open) {
      setFilters(initialFilters);
    }
  }, [open, initialFilters]);

  // Preview count com debounce 400ms — evita request a cada keystroke
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      countLeads({ ...filters, ...baseFilters })
        .then((n) => {
          if (!cancelled) setPreviewCount(n);
        })
        .catch(() => {
          if (!cancelled) setPreviewCount(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, filters, baseFilters, countLeads]);

  const toggleColumn = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExport = async (format: "csv" | "xlsx") => {
    if (previewCount === 0) {
      toast.error("Nada pra exportar com esses filtros.");
      return;
    }
    if (selectedKeys.size === 0) {
      toast.error("Selecione ao menos uma coluna.");
      return;
    }
    setExporting(true);
    try {
      const rows = await fetchAllLeads({ ...filters, ...baseFilters });
      const cols = availableColumns.filter((c) => selectedKeys.has(c.key));
      const result = onDownload(rows, cols, format);
      if (!result.ok) {
        toast.error(result.reason ?? "Falha ao exportar");
        return;
      }
      toast.success(
        `${rows.length.toLocaleString("pt-BR")} lead${rows.length === 1 ? "" : "s"} exportado${rows.length === 1 ? "" : "s"} (${format.toUpperCase()})`,
        { duration: 5000 },
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao exportar leads",
      );
    } finally {
      setExporting(false);
    }
  };

  const allSelected = selectedKeys.size === availableColumns.length;
  const noneSelected = selectedKeys.size === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl w-[92vw] sm:max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-5 py-4 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Download className="size-5 text-primary" />
            Exportar leads
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Filtre, escolha as colunas e baixe em Excel ou CSV.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* === Filtros avançados (Popover compacto) === */}
          <section className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Filtros aplicados
            </Label>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 text-xs text-muted-foreground">
                {baseFilters.search && (
                  <div>
                    Busca: <span className="font-medium text-foreground">&ldquo;{baseFilters.search}&rdquo;</span>
                  </div>
                )}
                {baseFilters.status && baseFilters.status !== "all" && (
                  <div>
                    Status: <span className="font-medium text-foreground">{baseFilters.status}</span>
                  </div>
                )}
                {baseFilters.tags && baseFilters.tags.length > 0 && (
                  <div>
                    Tags: <span className="font-medium text-foreground">{baseFilters.tags.length} selecionada{baseFilters.tags.length === 1 ? "" : "s"}</span>
                  </div>
                )}
                {!baseFilters.search && (!baseFilters.status || baseFilters.status === "all") && (!baseFilters.tags || baseFilters.tags.length === 0) && (
                  <div className="italic">Sem filtros básicos da lista.</div>
                )}
              </div>
              <LeadsAdvancedFilters
                value={filters}
                onChange={setFilters}
                assignees={assignees}
                sources={sources}
              />
            </div>
          </section>

          {/* === Preview count === */}
          <section className="rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-3">
              {previewLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="size-2 rounded-full bg-success" aria-hidden />
              )}
              <div className="flex-1">
                <div className="text-2xl font-bold tabular-nums text-foreground">
                  {previewCount === null
                    ? "—"
                    : previewCount.toLocaleString("pt-BR")}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {previewLoading
                    ? "Calculando..."
                    : previewCount === 1
                    ? "lead será exportado"
                    : "leads serão exportados"}
                </div>
              </div>
            </div>
          </section>

          {/* === Colunas a incluir === */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Colunas a incluir ({selectedKeys.size}/{availableColumns.length})
              </Label>
              <button
                type="button"
                onClick={() =>
                  setSelectedKeys(
                    allSelected
                      ? new Set()
                      : new Set(availableColumns.map((c) => c.key)),
                  )
                }
                className="text-xs font-medium text-primary hover:underline"
              >
                {allSelected ? "Desmarcar tudo" : "Selecionar tudo"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {availableColumns.map((col) => {
                const checked = selectedKeys.has(col.key);
                return (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleColumn(col.key)}
                    />
                    <span className="text-sm truncate">{col.label}</span>
                  </label>
                );
              })}
            </div>
            {noneSelected && (
              <p className="text-xs text-destructive">
                Selecione ao menos uma coluna.
              </p>
            )}
          </section>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3 shrink-0 flex-row items-center justify-between sm:space-x-0 gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={exporting}
          >
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleExport("csv")}
              disabled={exporting || previewCount === 0 || noneSelected}
              className="gap-2"
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileText className="size-4 text-primary" />
              )}
              CSV
            </Button>
            <Button
              type="button"
              onClick={() => handleExport("xlsx")}
              disabled={exporting || previewCount === 0 || noneSelected}
              className="gap-2"
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-4" />
              )}
              Excel
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
