"use client";

// AI Agent — shell visual compartilhado pra todos os nodes do canvas.
//
// PR-FLOW-PIVOT PR 3 (mai/2026): padrão visual de card com ícone roxo
// pastel + título + descritor + footer com handles. Cada tipo de node
// (entry/ai_agent/action/condition) reusa essa shell e injeta seu
// próprio conteúdo + handles.

import * as React from "react";
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
  children?: React.ReactNode;
}

// Variants usam tokens semânticos do design system (ver globals.css):
// success (verde), primary (azul), progress (roxo), warning (âmbar via muted).
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
  children,
}: NodeShellProps) {
  const styles = VARIANT_STYLES[variant];
  return (
    <div
      className={cn(
        "rounded-xl border-2 shadow-sm transition-all w-[260px]",
        styles.container,
        selected
          ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
          : "hover:shadow-md",
      )}
    >
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
          <div className="text-sm font-semibold leading-tight text-foreground">
            {label}
          </div>
          {badge ? (
            <div
              className={cn(
                "mt-0.5 text-[10px] font-medium uppercase tracking-wide",
                styles.badge,
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
    </div>
  );
}
