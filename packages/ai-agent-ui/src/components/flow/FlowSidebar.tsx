"use client";

// AI Agent — sidebar "Adicionar Tarefa" do FlowCanvas.
//
// PR-FLOW-PIVOT PR 3 (mai/2026): cards arrastáveis organizados em 3
// categorias (Entrada / Ações / Segmentações) — vocabulário PT-BR
// natural, sem jargão de runtime. Padrão inspirado nos screenshots
// Jordan/SaaS (ver feedback_ai_agent_automations_pattern.md em memory).
//
// Drag-drop usa nativo HTML5 (dataTransfer). FlowCanvas escuta `onDrop`
// e instancia o node via `findSidebarItem(taskKey)`.

import * as React from "react";
import { ChevronDown, Layers, Plus, Search } from "lucide-react";
import { cn } from "@persia/ui/utils";
import { Button } from "@persia/ui/button";
import { Input } from "@persia/ui/input";
import {
  FLOW_SIDEBAR_CATEGORIES,
  type FlowSidebarItem,
} from "./node-catalog";

export const FLOW_DRAG_KEY = "application/x-persia-flow-task";

interface FlowSidebarProps {
  /** Esconde a sidebar inteira (modo "fullscreen canvas"). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** PR 17 UX (mai/2026): callback de clique no botão + (alternativa ao
   * drag-drop). Adiciona o item no centro visível do canvas. */
  onAdd?: (taskKey: string) => void;
}

export function FlowSidebar({ collapsed, onAdd }: FlowSidebarProps) {
  const [search, setSearch] = React.useState("");
  const [openCats, setOpenCats] = React.useState<Set<string>>(
    () => new Set(FLOW_SIDEBAR_CATEGORIES.map((c) => c.id)),
  );

  const toggleCat = (id: string) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredCategories = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return FLOW_SIDEBAR_CATEGORIES;
    return FLOW_SIDEBAR_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q),
      ),
    })).filter((c) => c.items.length > 0);
  }, [search]);

  if (collapsed) return null;

  return (
    <aside className="w-[280px] shrink-0 border-r border-border/60 bg-background flex flex-col">
      <header className="p-3 border-b border-border/60 space-y-2">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Adicionar ao fluxo</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Clique no <Plus className="inline size-3 align-middle" /> ou arraste
          um card pro canvas.
        </p>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar tarefas..."
            className="pl-7 h-8 text-xs"
          />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredCategories.map((cat) => {
          const isOpen = openCats.has(cat.id);
          return (
            <div key={cat.id} className="rounded-lg border border-border/40 bg-card">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => toggleCat(cat.id)}
                className="w-full justify-between px-3 py-2 h-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground hover:bg-transparent"
                aria-expanded={isOpen}
              >
                <span>{cat.label}</span>
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    isOpen ? "" : "-rotate-90",
                  )}
                />
              </Button>
              {isOpen ? (
                <div className="border-t border-border/40 p-1.5 space-y-1">
                  {cat.items.map((item) => (
                    <DraggableCard
                      key={item.task_key}
                      item={item}
                      onAdd={onAdd}
                    />
                  ))}
                  {cat.items.length === 0 ? (
                    <div className="px-2 py-3 text-[11px] italic text-muted-foreground/70">
                      Nenhuma tarefa nessa categoria.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function DraggableCard({
  item,
  onAdd,
}: {
  item: FlowSidebarItem;
  onAdd?: (taskKey: string) => void;
}) {
  const Icon = item.icon;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(FLOW_DRAG_KEY, item.task_key);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="group relative flex items-start gap-2 px-2 py-2 rounded-md cursor-grab active:cursor-grabbing hover:bg-accent transition-colors"
    >
      <div className="size-8 shrink-0 rounded-md bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary/20">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold leading-tight">
          {item.label}
        </div>
        <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
          {item.description}
        </p>
      </div>
      {/* PR 17 UX (mai/2026): botão + no hover pra adicionar via clique
          (alternativa ao drag). */}
      {onAdd ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Adicionar ${item.label} ao fluxo`}
          onClick={(e) => {
            e.stopPropagation();
            onAdd(item.task_key);
          }}
          className="absolute right-1 top-1 !size-6 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Plus className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
