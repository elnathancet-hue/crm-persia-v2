"use client";

// EmptyState (PR-0) — versao opinionated do <Empty> base, padronizada
// pra todos os "nada aqui" do sistema. Usa o pattern visual dos
// PRs anteriores:
//   - Box rounded-xl com icone size-6 em bg-muted text-muted-foreground
//   - Titulo bold + descricao opcional muted
//   - Action opcional (ButtonNode) renderizada abaixo
//
// Uso:
//   <EmptyState
//     icon={<Users />}
//     title="Nenhum lead encontrado"
//     description="Cadastre seu primeiro lead para começar"
//     action={<Button>Novo lead</Button>}
//   />
//
// Variants:
//   - default: card border-dashed bg-muted/20 (descoberta)
//   - subtle: sem border, bg transparente (dentro de outros containers)
//
// Tones (PR-A mai/2026 mockup ChatGPT):
//   - muted (default): icone em bg-muted text-muted-foreground (neutro)
//   - primary: icone size-14 rounded-2xl em bg-primary/10 text-primary
//     (CTA proeminente, estado-zero de feature)

import * as React from "react";

import { cn } from "../utils";

export type EmptyStateVariant = "default" | "subtle";
export type EmptyStateTone = "muted" | "primary";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: EmptyStateVariant;
  /**
   * Cor do icone container. Default "muted" (cinza neutro). Use "primary"
   * em estados-zero de feature onde voce quer destaque visual (CTA forte).
   */
  tone?: EmptyStateTone;
  className?: string;
}

const VARIANT_CLASSES: Record<EmptyStateVariant, string> = {
  default:
    "rounded-xl border border-dashed border-border/60 bg-muted/20",
  subtle: "",
};

const TONE_ICON_CLASSES: Record<EmptyStateTone, string> = {
  muted:
    "size-12 rounded-xl bg-muted text-muted-foreground [&_svg:not([class*='size-'])]:size-6",
  primary:
    "size-14 rounded-2xl bg-primary/10 text-primary [&_svg:not([class*='size-'])]:size-7",
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "default",
  tone = "muted",
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center",
            TONE_ICON_CLASSES[tone],
          )}
        >
          {icon}
        </div>
      )}
      <div className="max-w-md space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
