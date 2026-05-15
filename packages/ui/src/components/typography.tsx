// Tipografia compartilhada — DS base PR (mai/2026).
//
// Por que existe: existiam ~10 ocorrencias copy-paste de
// `text-3xl font-bold tracking-tight font-heading` em page headers
// e ~30 ocorrencias de `text-xs font-bold uppercase tracking-wide
// text-muted-foreground` em section labels (filtros, drawers, dialogs).
// Cada uma evoluindo divergente — alguma com `mb-2`, outra com tracking
// diferente, outra esquecendo o `font-heading`.
//
// Centralizar aqui:
//   - `<PageTitle>`     headings de pagina (h1)
//   - `<SectionLabel>`  rotulos de secao em forms/drawers/filtros
//   - `<KpiValue>`      numeros grandes (dashboard, preview count, totais)
//   - `<MutedHint>`     helper text (cinza, pequeno)
//
// Todos polimorficos via `as` pra preservar semantica HTML correta.

import * as React from "react";
import { cn } from "../utils";

// --- PageTitle ----------------------------------------------------------
// Heading de pagina. Default `<h1>`. Pode virar `<h2>` em modal/drawer.
export interface PageTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: "h1" | "h2" | "h3";
  /** Variante de tamanho. `default` = pagina inteira, `compact` = drawer/dialog. */
  size?: "default" | "compact";
}

export const PageTitle = React.forwardRef<HTMLHeadingElement, PageTitleProps>(
  function PageTitle({ as = "h1", size = "default", className, ...props }, ref) {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref}
        data-slot="page-title"
        className={cn(
          "font-heading font-bold tracking-tight text-foreground",
          size === "default" ? "text-3xl" : "text-xl",
          className,
        )}
        {...props}
      />
    );
  },
);

// --- SectionLabel -------------------------------------------------------
// Rotulo bold-uppercase usado em forms/filtros/drawers como divisor.
// Default = `<div>` pra evitar conflito quando ja existe <label> aninhado
// (caso comum em filtros). Use `as="label"` quando for label real.
//
// PR-ANTIBUG (mai/2026): aceita `icon` prop. Antes cada section label
// renderizava `<Contact className="size-4 text-blue-500" />` ou
// `<TagIcon className="size-4 text-orange-500" />` — cores aleatorias
// sem semantica. Agora o icone vai sempre como `text-muted-foreground`:
//
//   import { Contact } from "lucide-react";
//   <SectionLabel icon={Contact}>Contato</SectionLabel>
export interface SectionLabelProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "children"> {
  as?: "div" | "span" | "label" | "p" | "h4";
  /** Componente de icone (ex: Contact do lucide-react). Renderiza muted. */
  icon?: React.ComponentType<{ className?: string }>;
  children?: React.ReactNode;
}

export const SectionLabel = React.forwardRef<HTMLElement, SectionLabelProps>(
  function SectionLabel(
    { as = "div", className, icon: Icon, children, ...props },
    ref,
  ) {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref as React.Ref<HTMLElement>}
        data-slot="section-label"
        className={cn(
          "inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground",
          className,
        )}
        {...props}
      >
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        {children}
      </Comp>
    );
  },
);

// --- KpiValue -----------------------------------------------------------
// Numero grande estilo dashboard / preview count. `tabular-nums` pra
// evitar jitter quando o valor atualiza em tempo real (debounce).
export interface KpiValueProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
}

export const KpiValue = React.forwardRef<HTMLDivElement, KpiValueProps>(
  function KpiValue({ size = "md", className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="kpi-value"
        className={cn(
          "font-bold tabular-nums text-foreground",
          size === "sm" && "text-xl",
          size === "md" && "text-2xl",
          size === "lg" && "text-3xl",
          className,
        )}
        {...props}
      />
    );
  },
);

// --- MutedHint ----------------------------------------------------------
// Texto auxiliar cinza, pequeno. Para dicas, captions, descrices secundarias.
export interface MutedHintProps extends React.HTMLAttributes<HTMLParagraphElement> {
  as?: "p" | "span" | "div";
}

export const MutedHint = React.forwardRef<HTMLParagraphElement, MutedHintProps>(
  function MutedHint({ as = "p", className, ...props }, ref) {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref}
        data-slot="muted-hint"
        className={cn("text-xs text-muted-foreground", className)}
        {...props}
      />
    );
  },
);
