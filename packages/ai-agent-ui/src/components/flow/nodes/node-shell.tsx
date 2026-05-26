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
//
// PR 20 UX (mai/2026): toolbar vertical flutuante à direita (inspirado
// no Jordan/ManyChat). Substitui o X único no canto por 3 ações:
//   - Lixeira (delete)
//   - Duplicar (clone)
//   - Info (tooltip com label)
// Aparece no hover/selected do node, alinhada verticalmente.

import * as React from "react";
import { AlertTriangle, Copy, Info, Trash2 } from "lucide-react";
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
  /** PR 17 (mai/2026): callback de remover. Quando passado, mostra
   * botão lixeira na toolbar. Entry node NÃO passa pra impedir delete. */
  onDelete?: () => void;
  /** PR 20 (mai/2026): callback de duplicar. Quando passado, mostra
   * botão copiar na toolbar. */
  onDuplicate?: () => void;
  children?: React.ReactNode;
  /** PR 21 (mai/2026): conteúdo expandido renderizado abaixo do body
   * quando node está `selected`. Usado pra config inline (form fields
   * dentro do próprio card, em vez de Sheet lateral). */
  expandedContent?: React.ReactNode;
  /** PR 23 (mai/2026): layout do painel expandido.
   *   - "compact" (default): 420px largura, max-h 480px com scroll.
   *     Ações/condições/entries têm poucos campos — cabe inteiro.
   *   - "wide": 560px largura, max-h 80vh. Pra IA, que tem muitos
   *     campos (prompt local, instructions[], tools, modelo override)
   *     e o cliente pediu pra "sustentar" todas opções sem recolher. */
  expandedLayout?: "compact" | "wide";
  /** PR 28 (mai/2026): quando true, mostra pulse animation por 5s
   * pra indicar que o Tester acabou de "passar" por aqui. Self-clears
   * via context — caller só precisa ler o highlight do hook. */
  recentlyExecuted?: boolean;
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
  onDuplicate,
  children,
  expandedContent,
  expandedLayout = "compact",
  recentlyExecuted,
}: NodeShellProps) {
  const styles = VARIANT_STYLES[variant];
  // PR 20 (mai/2026): tooltip do info icon (mostra label completo +
  // descrição em hover). State simples pra ativar no hover do botão.
  const [infoOpen, setInfoOpen] = React.useState(false);
  const hasToolbar = Boolean(onDelete || onDuplicate);
  // UX mai/2026: os cards ficam sempre completos no canvas. A seleção
  // continua destacando o card, mas não controla mais abrir/fechar form.
  const isExpanded = Boolean(expandedContent);
  const isWide = isExpanded && expandedLayout === "wide";
  return (
    <div
      className={cn(
        "group rounded-xl border-2 shadow-sm transition-all relative",
        // PR 21 + PR 23: largura cresce quando expandido (form inline).
        // wide layout (IA) ganha mais largura.
        isWide
          ? "w-[560px]"
          : isExpanded
            ? "w-[420px]"
            : "w-[260px]",
        // PR 17: borda âmbar/failure se incompleto (override variant color)
        incomplete ? "border-failure/70 bg-card" : styles.container,
        selected
          ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
          : "hover:shadow-md",
        // PR 28 (mai/2026): pulse animation quando o Tester acabou de
        // executar este node. Tailwind animate-pulse + ring primary
        // dão efeito "destaque por 5s" visível no canvas. Override do
        // hover:shadow-md acima (transition-all garante interpolação).
        recentlyExecuted &&
          "animate-pulse ring-4 ring-primary/60 ring-offset-2 ring-offset-background shadow-lg",
      )}
    >
      {/* PR 20 (mai/2026): toolbar vertical flutuante à direita,
          inspirada no Jordan/ManyChat. 3 botões empilhados: lixeira /
          duplicar / info. Aparece em hover/selected. Stop propagation
          pra não disparar onClick do node. */}
      {hasToolbar ? (
        <div
          className={cn(
            "absolute -right-9 top-0 z-10 flex flex-col gap-0.5 rounded-lg bg-primary p-0.5 shadow-md",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            selected && "opacity-100",
          )}
        >
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              aria-label="Remover esta tarefa"
              className="size-7 rounded-md flex items-center justify-center text-primary-foreground hover:bg-primary-foreground/15 transition-colors"
              title="Remover"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
          {onDuplicate ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              aria-label="Duplicar esta tarefa"
              className="size-7 rounded-md flex items-center justify-center text-primary-foreground hover:bg-primary-foreground/15 transition-colors"
              title="Duplicar"
            >
              <Copy className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => setInfoOpen(true)}
            onMouseLeave={() => setInfoOpen(false)}
            aria-label="Informações"
            className="relative size-7 rounded-md flex items-center justify-center text-primary-foreground hover:bg-primary-foreground/15 transition-colors"
          >
            <Info className="size-3.5" />
            {infoOpen ? (
              <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground shadow-md pointer-events-none">
                {label}
              </span>
            ) : null}
          </button>
        </div>
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
      {/* PR 21: form inline aparece quando selected + expandedContent
          definido. Renderiza dentro do próprio card em vez de Sheet
          lateral. PR 23: layout "wide" libera mais altura — IA tem
          muitos campos e cliente pediu pra ver todos sem precisar
          recolher seções. */}
      {isExpanded ? (
        <div
          className={cn(
            "border-t border-border/60 px-3 py-3 bg-muted/20 overflow-y-auto",
            isWide ? "max-h-[80vh]" : "max-h-[480px]",
          )}
        >
          {expandedContent}
        </div>
      ) : null}
    </div>
  );
}
