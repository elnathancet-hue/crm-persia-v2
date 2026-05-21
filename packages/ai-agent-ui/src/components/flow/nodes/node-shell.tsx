"use client";

// AI Agent — shell visual compartilhado pra todos os nodes do canvas.
//
// PR-FLOW-PIVOT PR 3 (mai/2026): padrão visual de card com ícone roxo
// pastel + título + descritor + footer com handles. Cada tipo de node
// (entry/ai_agent/action/condition) reusa essa shell e injeta seu
// próprio conteúdo + handles.
//
// PR 17 UX (mai/2026): novos props pra UX clara:
//   - incomplete + incomplete_reason: borda amarela + ícone alerta +
//     texto "Falta X" pra usuário ver que precisa configurar
//   - onDelete: botão X no canto superior direito (hover/selected) —
//     usuário não precisa abrir Sheet só pra remover

import * as React from "react";
import { AlertTriangle, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@persia/ui/utils";

interface NodeShellProps {
  icon: LucideIcon;
  label: string;
  /** Descritor sob o título (ex: "Conversa iniciada", "Ação automática"). */
  badge?: string;
  /** Quando true, mostra outline destacado. Usado em selected state. */
  selected?: boolean;
  /** Tema de cor — entry=verde, ai_agent=primary, action=roxo, condition=âmbar. */
  variant?: "entry" | "ai_agent" | "action" | "condition";
  /** PR 17 (mai/2026): quando true, borda âmbar + ícone alerta + texto. */
  incomplete?: boolean;
  /** Mensagem mostrada quando incomplete (ex: "Falta selecionar tag"). */
  incompleteReason?: string;
  /** PR 17 (mai/2026): callback de remover. Quando passado, mostra X
   * no canto. Entry node NÃO passa pra impedir delete. */
  onDelete?: () => void;
  children?: React.ReactNode;
}

const VARIANT_STYLES: Record<
  NonNullable<NodeShellProps["variant"]>,
  { container: string; icon: string; badge: string }
> = {
  entry: {
    container: "border-success/40 bg-card",
    icon: "bg-success-soft text-success-soft-foreground",
    badge: "text-success",
  },
  ai_agent: {
    container: "border-primary/40 bg-card",
    icon: "bg-primary/15 text-primary",
    badge: "text-primary",
  },
  action: {
    container: "border-progress/40 bg-card",
    icon: "bg-progress-soft text-progress-soft-foreground",
    badge: "text-progress",
  },
  condition: {
    container: "border-muted bg-card",
    icon: "bg-muted text-muted-foreground",
    badge: "text-muted-foreground",
  },
};

export function NodeShell({
  icon: Icon,
  label,
  badge,
  selected,
  variant = "action",
  incomplete,
  incompleteReason,
  onDelete,
  children,
}: NodeShellProps) {
  const styles = VARIANT_STYLES[variant];
  return (
    <div
      className={cn(
        "group rounded-xl border-2 shadow-sm transition-all w-[260px] relative",
        // PR 17: borda âmbar/failure se incompleto (override variant color)
        incomplete ? "border-failure/70 bg-card" : styles.container,
        selected
          ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
          : "hover:shadow-md",
      )}
    >
      {/* PR 17 (mai/2026): botão X no canto superior direito.
          Aparece em hover/selected, só quando onDelete é injetado
          (entry node não passa). Stop propagation pra clique no X
          não disparar onClick do node. */}
      {onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Remover esta tarefa"
          className={cn(
            "absolute -top-2 -right-2 z-10 size-5 rounded-full bg-destructive text-destructive-foreground",
            "flex items-center justify-center shadow-md",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            selected && "opacity-100",
            "hover:scale-110 transition-transform",
          )}
        >
          <X className="size-3" />
        </button>
      ) : null}

      <div className="flex items-start gap-2.5 p-3">
        <div
          className={cn(
            "size-9 shrink-0 rounded-lg flex items-center justify-center",
            styles.icon,
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-semibold leading-tight text-foreground">
              {label}
            </div>
            {incomplete ? (
              <AlertTriangle
                className="size-3.5 text-failure shrink-0"
                aria-label="Tarefa incompleta"
              />
            ) : null}
          </div>
          {badge ? (
            <div
              className={cn(
                "mt-0.5 text-[10px] font-medium uppercase tracking-wide",
                incomplete ? "text-failure" : styles.badge,
              )}
            >
              {badge}
            </div>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
          {children}
        </div>
      ) : null}
      {/* PR 17: linha de aviso quando incompleto. Aparece embaixo do
          conteúdo, com cor failure pra leitura rápida. */}
      {incomplete && incompleteReason ? (
        <div className="border-t border-failure/30 px-3 py-1.5 text-[10px] font-medium text-failure flex items-center gap-1.5">
          <AlertTriangle className="size-3" />
          {incompleteReason}
        </div>
      ) : null}
    </div>
  );
}
