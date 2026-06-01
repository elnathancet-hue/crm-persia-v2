"use client";

import * as React from "react";
import { DialogShell, type DialogShellProps } from "./dialog-shell";
import { cn } from "../utils";

export interface FeatureDialogProps
  extends Omit<DialogShellProps, "children" | "headerExtras"> {
  /** Conteudo de apoio no topo do corpo: metricas, filtros ou contexto. */
  summary?: React.ReactNode;
  /** Acoes do header, como Exportar, Sincronizar ou Criar. */
  actions?: React.ReactNode;
  /** Conteudo principal scrollavel. */
  children: React.ReactNode;
  /** Footer fixo opcional. */
  footer?: React.ReactNode;
  bodyClassName?: string;
  footerClassName?: string;
}

export function FeatureDialog({
  summary,
  actions,
  children,
  footer,
  bodyClassName,
  footerClassName,
  ...props
}: FeatureDialogProps) {
  return (
    <DialogShell
      {...props}
      headerExtras={
        actions ? (
          <div className="flex flex-wrap items-center justify-end gap-inline">
            {actions}
          </div>
        ) : undefined
      }
    >
      <DialogShell.Body
        className={cn("space-y-stack-lg", bodyClassName)}
      >
        {summary && (
          <div data-slot="feature-dialog-summary" className="shrink-0">
            {summary}
          </div>
        )}
        {children}
      </DialogShell.Body>
      {footer && (
        <DialogShell.Footer
          justify="end"
          className={footerClassName}
        >
          {footer}
        </DialogShell.Footer>
      )}
    </DialogShell>
  );
}

