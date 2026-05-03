"use client";

// Export utility (PR-K3)
//
// Geracao client-side de CSV/XLSX com a lib `xlsx` (ja instalada
// pelo PR-K1 pra parsing). Aceita rows arbitrarias + headers
// custom + nome do arquivo + formato.
//
// Por que client-side: evita ida ao server, evita stream de bytes
// pro browser, e respeita filtros locais ja aplicados (filteredDeals).
// Cap de 10000 linhas pra evitar travar a aba — se passar disso,
// avisa e deixa o usuario quebrar o filtro.

import * as XLSX from "xlsx";

export type ExportFormat = "csv" | "xlsx";

export interface ExportColumn<T> {
  /** Header mostrado no arquivo. */
  header: string;
  /** Funcao que extrai valor da row. Deve retornar string/number/Date. */
  accessor: (row: T) => string | number | Date | null | undefined;
}

export const EXPORT_MAX_ROWS = 10000;

export interface ExportOptions<T> {
  rows: T[];
  columns: ExportColumn<T>[];
  /** Sem extensao — adicionada conforme format. Ex: "leads-2026-04". */
  filename: string;
  format: ExportFormat;
  /** Nome da sheet (XLSX). Default "Dados". */
  sheetName?: string;
}

/**
 * Gera arquivo + dispara download. Sem return — toast e responsabilidade
 * do caller.
 */
export function downloadExport<T>(opts: ExportOptions<T>): {
  ok: boolean;
  exported_count: number;
  reason?: string;
} {
  if (opts.rows.length === 0) {
    return { ok: false, exported_count: 0, reason: "Nada pra exportar." };
  }
  if (opts.rows.length > EXPORT_MAX_ROWS) {
    return {
      ok: false,
      exported_count: 0,
      reason: `Limite de ${EXPORT_MAX_ROWS.toLocaleString("pt-BR")} linhas. Aplique filtros pra reduzir antes de exportar.`,
    };
  }

  // Converte rows pra matriz de objetos com header como key
  const records = opts.rows.map((row) => {
    const rec: Record<string, string | number | Date | null | undefined> = {};
    for (const col of opts.columns) {
      rec[col.header] = col.accessor(row);
    }
    return rec;
  });

  const sheet = XLSX.utils.json_to_sheet(records, {
    header: opts.columns.map((c) => c.header),
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, opts.sheetName ?? "Dados");

  const bookType: "csv" | "xlsx" = opts.format;
  const buffer = XLSX.write(workbook, {
    bookType,
    type: "array",
  }) as ArrayBuffer;

  // Dispara download via Blob + anchor
  const mime =
    bookType === "csv"
      ? "text/csv;charset=utf-8;"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  // CSV: prefixa BOM (﻿) pra Excel detectar UTF-8
  let blob: Blob;
  if (bookType === "csv") {
    const text = new TextDecoder().decode(buffer);
    blob = new Blob(["﻿" + text], { type: mime });
  } else {
    blob = new Blob([buffer], { type: mime });
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${opts.filename}.${bookType}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  return { ok: true, exported_count: opts.rows.length };
}

/**
 * Helper pra gerar filename padronizado: "{kind}-YYYY-MM-DD-HHmm".
 * Ex: leads-2026-05-03-1845, deals-2026-05-03-1845.
 */
export function makeExportFilename(kind: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${kind}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
