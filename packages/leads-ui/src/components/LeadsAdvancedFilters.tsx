"use client";

// Filtros avançados pra tab Leads. Abre como Popover compacto a partir
// de um botão "Filtros" no header. Mantém UX limpa (filtros básicos
// ficam visíveis, avançados ficam atrás de 1 clique).
//
// Filtros suportados:
//   - Período de criação (date range + atalhos)
//   - Última interação (3 modos: qualquer | últimos N dias | sem há N dias)
//   - Responsável (multi-select + sentinela "__none__" = sem responsável)
//   - Origem/Canal (multi-select)
//
// Briefing produto: "boa interatividade do usuário".
//   - Atalhos rápidos pra os 90% dos casos (Hoje/7d/30d/Mês)
//   - Inputs HTML5 nativos (calendar mobile/desktop sem dep)
//   - Pills de filtros ativos visíveis fora do popover

import * as React from "react";
import { Calendar, Filter as FilterIcon, X } from "lucide-react";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import { Label } from "@persia/ui/label";
import { Checkbox } from "@persia/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@persia/ui/popover";

export interface LeadsAdvancedFiltersValue {
  /** ISO yyyy-mm-dd. */
  dateFrom?: string;
  /** ISO yyyy-mm-dd (incluido o dia inteiro no caller). */
  dateTo?: string;
  /**
   * Modo do filtro de última interação:
   *   - "any": sem filtro
   *   - "withinDays": last_interaction_at >= now - N dias (leads ativos)
   *   - "olderThanDays": last_interaction_at <= now - N dias (leads frios)
   */
  lastInteractionMode?: "any" | "withinDays" | "olderThanDays";
  lastInteractionDays?: number;
  /** UUIDs dos responsáveis. "__none__" = sem responsável. Vazio = todos. */
  assigneeIds?: string[];
  /** Origens (whatsapp, manual, import, etc). Vazio = todas. */
  sources?: string[];
}

export interface LeadsAdvancedFiltersProps {
  value: LeadsAdvancedFiltersValue;
  onChange: (next: LeadsAdvancedFiltersValue) => void;
  /** Lista de responsáveis pra render (avatares + nomes). */
  assignees: { id: string; name: string }[];
  /** Origens conhecidas (auto-extraídas dos leads OU lista fixa). */
  sources: string[];
  /** Slot extra dentro do popover (ex: contador de leads filtrados). */
  footerExtras?: React.ReactNode;
}

// Atalhos de período (DesignFlow: discretos, fácil click).
const DATE_PRESETS: { label: string; days: number }[] = [
  { label: "Hoje", days: 0 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function countActive(v: LeadsAdvancedFiltersValue): number {
  let n = 0;
  if (v.dateFrom || v.dateTo) n++;
  if (v.lastInteractionMode && v.lastInteractionMode !== "any") n++;
  if (v.assigneeIds && v.assigneeIds.length > 0) n++;
  if (v.sources && v.sources.length > 0) n++;
  return n;
}

export function LeadsAdvancedFilters({
  value,
  onChange,
  assignees,
  sources,
  footerExtras,
}: LeadsAdvancedFiltersProps) {
  const [open, setOpen] = React.useState(false);
  const activeCount = countActive(value);

  const applyPreset = (days: number) => {
    onChange({
      ...value,
      dateFrom: daysAgoISO(days),
      dateTo: todayISO(),
    });
  };

  const toggleAssignee = (id: string) => {
    const cur = value.assigneeIds ?? [];
    const next = cur.includes(id)
      ? cur.filter((x) => x !== id)
      : [...cur, id];
    onChange({ ...value, assigneeIds: next });
  };

  const toggleSource = (s: string) => {
    const cur = value.sources ?? [];
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    onChange({ ...value, sources: next });
  };

  const clearAll = () => {
    onChange({
      dateFrom: undefined,
      dateTo: undefined,
      lastInteractionMode: "any",
      lastInteractionDays: undefined,
      assigneeIds: [],
      sources: [],
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="default"
            className={`h-10 rounded-md ${
              activeCount > 0
                ? "border-primary/40 bg-primary/5 text-primary"
                : ""
            }`}
          />
        }
      >
        <FilterIcon className="size-4" data-icon="inline-start" />
        Filtros
        {activeCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground min-w-[1.25rem] h-5">
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[92vw] sm:w-[420px] p-0 rounded-2xl"
      >
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Filtros avançados
          </h3>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
              Limpar tudo
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-5">
          {/* === Periodo de criacao === */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Calendar className="size-3.5 text-muted-foreground" />
              <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Período de criação
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="filter-date-from" className="text-[11px] text-muted-foreground">
                  De
                </Label>
                <Input
                  id="filter-date-from"
                  name="filter_date_from"
                  type="date"
                  value={value.dateFrom ?? ""}
                  onChange={(e) =>
                    onChange({ ...value, dateFrom: e.target.value || undefined })
                  }
                  className="h-9"
                />
              </div>
              <div>
                <Label htmlFor="filter-date-to" className="text-[11px] text-muted-foreground">
                  Até
                </Label>
                <Input
                  id="filter-date-to"
                  name="filter_date_to"
                  type="date"
                  value={value.dateTo ?? ""}
                  onChange={(e) =>
                    onChange({ ...value, dateTo: e.target.value || undefined })
                  }
                  className="h-9"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.days)}
                  className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  onChange({ ...value, dateFrom: undefined, dateTo: undefined })
                }
                className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Tudo
              </button>
            </div>
          </section>

          {/* === Ultima interacao === */}
          <section className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Última interação
            </Label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="last-interaction"
                  checked={!value.lastInteractionMode || value.lastInteractionMode === "any"}
                  onChange={() =>
                    onChange({ ...value, lastInteractionMode: "any", lastInteractionDays: undefined })
                  }
                  className="size-3.5"
                />
                <span className="text-sm">Qualquer</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="last-interaction"
                  checked={value.lastInteractionMode === "withinDays"}
                  onChange={() =>
                    onChange({
                      ...value,
                      lastInteractionMode: "withinDays",
                      lastInteractionDays: value.lastInteractionDays ?? 7,
                    })
                  }
                  className="size-3.5"
                />
                <span className="text-sm">Ativos nos últimos</span>
                <Input
                  name="filter_li_within_days"
                  type="number"
                  min={1}
                  max={365}
                  value={
                    value.lastInteractionMode === "withinDays"
                      ? value.lastInteractionDays ?? 7
                      : ""
                  }
                  onChange={(e) =>
                    onChange({
                      ...value,
                      lastInteractionMode: "withinDays",
                      lastInteractionDays: parseInt(e.target.value || "0", 10) || undefined,
                    })
                  }
                  disabled={value.lastInteractionMode !== "withinDays"}
                  className="h-7 w-16 text-sm"
                />
                <span className="text-sm text-muted-foreground">dias</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="last-interaction"
                  checked={value.lastInteractionMode === "olderThanDays"}
                  onChange={() =>
                    onChange({
                      ...value,
                      lastInteractionMode: "olderThanDays",
                      lastInteractionDays: value.lastInteractionDays ?? 30,
                    })
                  }
                  className="size-3.5"
                />
                <span className="text-sm">Frios há</span>
                <Input
                  name="filter_li_older_days"
                  type="number"
                  min={1}
                  max={3650}
                  value={
                    value.lastInteractionMode === "olderThanDays"
                      ? value.lastInteractionDays ?? 30
                      : ""
                  }
                  onChange={(e) =>
                    onChange({
                      ...value,
                      lastInteractionMode: "olderThanDays",
                      lastInteractionDays: parseInt(e.target.value || "0", 10) || undefined,
                    })
                  }
                  disabled={value.lastInteractionMode !== "olderThanDays"}
                  className="h-7 w-16 text-sm"
                />
                <span className="text-sm text-muted-foreground">dias ou mais</span>
              </label>
            </div>
          </section>

          {/* === Responsavel === */}
          {assignees.length > 0 && (
            <section className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Responsável
              </Label>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                  <Checkbox
                    checked={value.assigneeIds?.includes("__none__") ?? false}
                    onCheckedChange={() => toggleAssignee("__none__")}
                  />
                  <span className="text-sm italic text-muted-foreground">
                    Sem responsável
                  </span>
                </label>
                {assignees.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={value.assigneeIds?.includes(a.id) ?? false}
                      onCheckedChange={() => toggleAssignee(a.id)}
                    />
                    <span className="text-sm truncate">{a.name}</span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* === Origem === */}
          {sources.length > 0 && (
            <section className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Origem / Canal
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s) => {
                  const active = value.sources?.includes(s) ?? false;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSource(s)}
                      aria-pressed={active}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {footerExtras && (
          <div className="border-t border-border px-4 py-3">{footerExtras}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
