"use client";

// ExportMenu (PR-K3) — botao com Popover oferecendo CSV/XLSX.
// Reutilizavel: aceita rows + columns + filename. Caller monta as
// columns conforme contexto (deals, leads, etc).

import * as React from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@persia/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@persia/ui/popover";
import {
  downloadExport,
  makeExportFilename,
  type ExportColumn,
} from "../lib/export";

interface ExportMenuProps<T> {
  /** Dados a exportar (ja filtrados pelo caller). */
  rows: T[];
  /** Definicao das colunas. */
  columns: ExportColumn<T>[];
  /** Prefixo do arquivo (sem extensao nem timestamp). Ex: "deals", "leads". */
  filenamePrefix: string;
  /** Sheet name pro XLSX. Default "Dados". */
  sheetName?: string;
  /** Trigger custom (default: botao ghost com icone Download). */
  triggerLabel?: string;
  triggerSize?: "sm" | "default";
  className?: string;
  /** Disabled state (ex: while data carregando). */
  disabled?: boolean;
}

export function ExportMenu<T>({
  rows,
  columns,
  filenamePrefix,
  sheetName,
  triggerLabel = "Exportar",
  triggerSize = "sm",
  className,
  disabled,
}: ExportMenuProps<T>) {
  const [open, setOpen] = React.useState(false);

  const handleExport = (format: "csv" | "xlsx") => {
    const result = downloadExport({
      rows,
      columns,
      filename: makeExportFilename(filenamePrefix),
      format,
      sheetName,
    });
    if (!result.ok) {
      toast.error(result.reason ?? "Falha ao exportar");
      return;
    }
    toast.success(
      `${result.exported_count} linha${result.exported_count === 1 ? "" : "s"} exportada${result.exported_count === 1 ? "" : "s"} (${format.toUpperCase()})`,
    );
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={triggerSize}
            className={className ?? "h-8 rounded-md px-2.5"}
            disabled={disabled || rows.length === 0}
            title={
              rows.length === 0
                ? "Nada pra exportar"
                : `Exportar ${rows.length} ${rows.length === 1 ? "linha" : "linhas"}`
            }
          />
        }
      >
        <Download className="size-3.5" />
        {triggerLabel}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5" sideOffset={6}>
        <button
          type="button"
          onClick={() => handleExport("xlsx")}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
        >
          <FileSpreadsheet className="size-4 text-success" />
          <div className="flex-1">
            <div className="font-medium">Excel (.xlsx)</div>
            <div className="text-[11px] text-muted-foreground">
              Recomendado pra abrir no Excel/Sheets
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleExport("csv")}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
        >
          <FileText className="size-4 text-primary" />
          <div className="flex-1">
            <div className="font-medium">CSV (.csv)</div>
            <div className="text-[11px] text-muted-foreground">
              Compatível com qualquer ferramenta
            </div>
          </div>
        </button>
        <div className="mt-1 border-t border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
          {/* PR-B1: o template anterior concatenava `sera` + `ão` gerando
              "seraão"; trocado por will-be conjugado completo, com acento
              no singular ("será") tambem. */}
          {rows.length.toLocaleString("pt-BR")} linha
          {rows.length === 1 ? "" : "s"}{" "}
          {rows.length === 1 ? "será" : "serão"}{" "}
          exportada{rows.length === 1 ? "" : "s"}.
        </div>
      </PopoverContent>
    </Popover>
  );
}
