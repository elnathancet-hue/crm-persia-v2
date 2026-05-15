"use client";

// StageBadge — UMA fonte de verdade pra renderizar uma stage com cor
// baseada no outcome (em_andamento / falha / bem_sucedido).
//
// PR-ANTIBUG (mai/2026): existiam 3 lugares (KanbanBoard, LeadInfoDrawer,
// PipelineStagesEditor) cada um mantendo sua propria tabela
// outcome -> classes Tailwind. Drift garantido. Solucao: fechar a regra
// num componente unico que mapeia outcome -> tokens semanticos
// (--color-success/failure/progress) automaticamente.
//
// Uso:
//   <StageBadge outcome="em_andamento">Contato</StageBadge>
//   <StageBadge stage={stage} variant="solid" />
//   <StageBadge outcome="bem_sucedido" size="sm" />
//
// Light/dark resolve sozinho via CSS vars do globals.css.

import * as React from "react";
import { cn } from "@persia/ui/utils";

// Outcome enum espelhado de @persia/shared/crm pra evitar dependencia
// circular na build. Se o enum mudar la, atualizar aqui.
type StageOutcome = "em_andamento" | "falha" | "bem_sucedido";

interface StageShape {
  name: string;
  outcome: StageOutcome | null;
}

export interface StageBadgeProps {
  /** Forma curta — passar a stage inteira. Renderiza stage.name. */
  stage?: StageShape;
  /** Forma longa — outcome + children custom. */
  outcome?: StageOutcome | null;
  children?: React.ReactNode;
  /** "soft" (default) bg translucido + texto da cor. "solid" bg cheio. */
  variant?: "soft" | "solid" | "dot";
  size?: "sm" | "default";
  className?: string;
}

// Mapeamento outcome -> tokens semanticos. UMA tabela na codebase inteira.
// Se quiser adicionar uma 4a categoria de outcome, atualiza aqui SO.
const OUTCOME_CLASSES: Record<
  StageOutcome,
  { soft: string; solid: string; dot: string; label: string }
> = {
  em_andamento: {
    soft: "bg-progress-soft text-progress-soft-foreground",
    solid: "bg-progress text-progress-foreground",
    dot: "bg-progress",
    label: "Em andamento",
  },
  falha: {
    soft: "bg-failure-soft text-failure-soft-foreground",
    solid: "bg-failure text-failure-foreground",
    dot: "bg-failure",
    label: "Falha",
  },
  bem_sucedido: {
    soft: "bg-success-soft text-success-soft-foreground",
    solid: "bg-success text-success-foreground",
    dot: "bg-success",
    label: "Bem-sucedido",
  },
};

const FALLBACK = {
  soft: "bg-muted text-muted-foreground",
  solid: "bg-muted text-foreground",
  dot: "bg-muted-foreground",
  label: "—",
};

export function StageBadge({
  stage,
  outcome: outcomeProp,
  children,
  variant = "soft",
  size = "default",
  className,
}: StageBadgeProps) {
  const outcome = outcomeProp ?? stage?.outcome ?? null;
  const cls = outcome ? OUTCOME_CLASSES[outcome] : FALLBACK;
  const text = children ?? stage?.name ?? cls.label;

  if (variant === "dot") {
    // Variante minimalista: ponto colorido + label cinza neutro.
    // Usado em listas onde o outcome e secundario (ex.: subheader).
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <span className={cn("size-1.5 rounded-full", cls.dot)} aria-hidden />
        {text}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        variant === "soft" ? cls.soft : cls.solid,
        className,
      )}
    >
      {text}
    </span>
  );
}

// Helper exportado pra componentes que ainda nao vao migrar pro
// <StageBadge> mas queiram pelo menos a cor consistente.
// Ex: KanbanBoard.OUTCOME_BUCKETS pode reusar isso.
export function getOutcomeClasses(outcome: StageOutcome | null) {
  return outcome ? OUTCOME_CLASSES[outcome] : FALLBACK;
}
