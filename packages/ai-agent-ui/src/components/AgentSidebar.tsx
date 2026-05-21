"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@persia/ui/utils";

// PR-AI-AGENT-SIDEBAR (mai/2026): substitui o array horizontal de 9 tabs
// underline (CrmTabs-style) por sidebar vertical com agrupamento. Razao:
// Hick-Hyman + Miller — 9 tabs flat sobrecarrega; 4 grupos com 2-3 itens
// cada respeitam o limite cognitivo (~7±2) e tornam a hierarquia visivel.
// Tester sai como tab/Sheet acionado pelo header — vira FAB fixo no canto
// (sempre acessivel, paridade com market: OpenAI Custom GPT, Claude
// Projects, Copilot Studio).
//
// PR 23 (mai/2026): suporte a modo collapsed pra abrir mais espaço pro
// canvas do Fluxo. Quando collapsed=true, sidebar fica com width ~3.5rem
// mostrando só ícones (sem grupo header, sem label, sem badge). Estado
// persiste em localStorage no AgentEditor.
//
// Mobile: sidebar vira drawer (Sheet) acionado por hamburger.

export interface AgentSidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // Quando o item exibe um indicador (ex: "5 etapas", "2 falhas"),
  // mostramos como badge no canto direito. null = sem badge.
  badge?: string | number | null;
}

export interface AgentSidebarGroup {
  id: string;
  label: string;
  items: AgentSidebarItem[];
}

interface Props {
  groups: AgentSidebarGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  // Render mode controla o estilo do container — "panel" e o desktop
  // padrao (rounded card lateral) e "drawer" e o mobile (full bleed
  // dentro de SheetContent, sem rounding/borda externa).
  variant?: "panel" | "drawer";
  /** PR 23 (mai/2026): quando true, sidebar fica fininha (só ícones).
   * Ignorado em variant="drawer" — drawer já é mobile e abre cheio. */
  collapsed?: boolean;
  /** PR 23: callback do botão de toggle collapse. Quando undefined, o
   * botão não aparece (drawer mobile, por ex). */
  onToggleCollapsed?: () => void;
}

export function AgentSidebar({
  groups,
  activeId,
  onSelect,
  variant = "panel",
  collapsed = false,
  onToggleCollapsed,
}: Props) {
  const isCollapsed = collapsed && variant === "panel";
  return (
    <nav
      aria-label="Navegação do editor do agente"
      className={cn(
        "flex flex-col gap-1 text-sm",
        variant === "panel" &&
          "sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl border border-border bg-card p-2 transition-all",
        variant === "drawer" && "p-1",
      )}
    >
      {/* PR 23: toggle de collapse no topo. Só aparece quando o caller
          passa onToggleCollapsed (desktop panel). Drawer mobile não tem
          — abre/fecha pelo hamburger global. */}
      {onToggleCollapsed && variant === "panel" ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={isCollapsed ? "Expandir menu" : "Recolher menu"}
          title={isCollapsed ? "Expandir menu" : "Recolher menu"}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors",
            isCollapsed ? "justify-center" : "justify-end",
          )}
        >
          {isCollapsed ? (
            <ChevronRight className="size-3.5" />
          ) : (
            <>
              <ChevronLeft className="size-3.5" />
              <span>Recolher</span>
            </>
          )}
        </button>
      ) : null}

      {groups.map((group, gIdx) => (
        <div
          key={group.id}
          className={cn("flex flex-col gap-0.5", gIdx > 0 && "mt-3")}
        >
          {!isCollapsed ? (
            <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </p>
          ) : (
            // Separador visual entre grupos no modo collapsed (sem texto).
            gIdx > 0 ? (
              <div className="mx-2 my-1 border-t border-border/40" aria-hidden />
            ) : null
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={isCollapsed ? item.label : undefined}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  "group flex items-center rounded-lg text-left font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isCollapsed
                    ? "justify-center px-2 py-2"
                    : "gap-2.5 px-3 py-2",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                {!isCollapsed ? (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge !== undefined && item.badge !== null ? (
                      <span
                        className={cn(
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-medium tabular-nums",
                          isActive
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
