"use client";

// Field card — section visual reutilizavel pros forms do NodeConfigSheet.
//
// Pattern inspirado nas referencias do cliente (Jordan/ManyChat): cada
// campo do form vira um "mini-card" com header colorido (icone + label
// + descricao opcional), corpo branco com o controle e helper text
// abaixo. Cores ajudam a orientar o olho — entry/saidas em primary,
// acoes terminais em progress, sucesso em success, etc.
//
// Aplicado em todos os 4 forms (entry, ai_agent, action, condition)
// pra consistencia. Nos forms com 1 campo so (ex: add_tag), o card
// fica visualmente discreto mas ainda agrupa label+input+helper de
// forma consistente.

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@persia/ui/utils";

export type FieldCardVariant =
  | "primary"     // entry triggers, AI prompt — roxo/azul
  | "success"     // saidas/eventos OK, add_tag — verde
  | "progress"    // acoes de execucao (mover stage, mídia, notificacao) — laranja
  | "destructive" // remover/cancelar — vermelho
  | "muted";      // metadata (nome do node, IDs) — cinza

interface FieldCardProps {
  icon: LucideIcon;
  title: string;
  /** Subtitulo curto sob o titulo, no header colorido. */
  description?: string;
  /** Tema visual — cor do header e do icone. */
  variant?: FieldCardVariant;
  /** Conteudo do card — geralmente Input/Select/Textarea + helper. */
  children: React.ReactNode;
  /** Texto auxiliar abaixo do controle, dentro do card branco. */
  helperText?: React.ReactNode;
  /** Quando true, mostra badge "Opcional" no canto do header. */
  optional?: boolean;
  /** Quando true, mostra asterisco discreto no titulo. */
  required?: boolean;
}

const VARIANT_STYLES: Record<FieldCardVariant, { header: string; icon: string; badge: string }> = {
  primary: {
    header: "bg-primary/8 border-primary/25",
    icon: "bg-primary/15 text-primary",
    badge: "text-primary/90",
  },
  success: {
    header: "bg-success-soft/60 border-success/25",
    icon: "bg-success-soft text-success-soft-foreground",
    badge: "text-success",
  },
  progress: {
    header: "bg-progress-soft/60 border-progress/25",
    icon: "bg-progress-soft text-progress-soft-foreground",
    badge: "text-progress",
  },
  destructive: {
    header: "bg-destructive/8 border-destructive/25",
    icon: "bg-destructive/15 text-destructive",
    badge: "text-destructive",
  },
  muted: {
    header: "bg-muted border-border",
    icon: "bg-muted-foreground/10 text-muted-foreground",
    badge: "text-foreground",
  },
};

export function FieldCard({
  icon: Icon,
  title,
  description,
  variant = "muted",
  children,
  helperText,
  optional,
  required,
}: FieldCardProps) {
  const styles = VARIANT_STYLES[variant];

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-card shadow-sm">
      {/* Header colorido com icone + titulo. Cor varia por variant. */}
      <div
        className={cn(
          "flex items-start gap-3 px-4 py-3 border-b",
          styles.header,
        )}
      >
        <div
          className={cn(
            "size-9 shrink-0 rounded-md flex items-center justify-center mt-0.5",
            styles.icon,
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn("text-sm font-semibold", styles.badge)}>
              {title}
              {required ? (
                <span className="ml-0.5 text-destructive" aria-hidden>
                  *
                </span>
              ) : null}
            </div>
            {optional ? (
              <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/60">
                Opcional
              </span>
            ) : null}
          </div>
          {description ? (
            <div className="mt-1 text-xs text-foreground leading-snug">
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {/* Corpo branco com o controle + helper. */}
      <div className="px-4 py-3 space-y-2">
        {children}
        {helperText ? (
          <p className="text-xs text-foreground leading-snug pt-0.5">
            {helperText}
          </p>
        ) : null}
      </div>
    </div>
  );
}
