// PageShell — pattern padronizado pra header+content de TODA pagina
// dentro do (dashboard) layout.
//
// PR-AUDIT (mai/2026): Quase todas as paginas reimplementavam h1+
// subtitulo+actions+spacing manualmente. Algumas usavam text-2xl,
// outras text-xl, algumas font-heading, outras nao. Resultado: a
// hierarquia visual variava por tela — produto parecia uma colecao
// de telas em vez de um sistema coeso.
//
// Pattern unificado:
//
//   <PageShell
//     title="Leads"
//     description="Sua base de leads atualizada"
//     actions={
//       <>
//         <Button variant="outline">Importar</Button>
//         <Button>Novo lead</Button>
//       </>
//     }
//   >
//     <LeadList ... />
//   </PageShell>
//
// Header sempre tem mesmo spacing (gap-section entre title/body),
// title sempre usa <PageTitle>, actions sempre alinham ao topo
// direito. Migrar paginas pra esse pattern = consistencia automatica.

import * as React from "react";
import { cn } from "../utils";
import { MutedHint, PageTitle } from "./typography";

export interface PageShellProps {
  /** Heading principal (h1). Renderiza via <PageTitle>. */
  title: React.ReactNode;
  /** Texto auxiliar abaixo do title. */
  description?: React.ReactNode;
  /** Botoes/CTAs no canto sup. direito. */
  actions?: React.ReactNode;
  /**
   * Variante de tamanho do header. Default "default" usa size="default"
   * do PageTitle (text-3xl). Use "compact" pra paginas secundarias.
   */
  size?: "default" | "compact";
  /** Conteudo principal. */
  children: React.ReactNode;
  /** className extra no wrapper externo. */
  className?: string;
}

export function PageShell({
  title,
  description,
  actions,
  size = "default",
  children,
  className,
}: PageShellProps) {
  return (
    <div className={cn("space-y-section", className)}>
      <header className="flex flex-wrap items-start justify-between gap-stack">
        <div className="min-w-0 space-y-1">
          <PageTitle size={size}>{title}</PageTitle>
          {description && <MutedHint className="text-sm">{description}</MutedHint>}
        </div>
        {actions && <div className="flex items-center gap-inline shrink-0">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
