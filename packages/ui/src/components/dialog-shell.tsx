"use client";

// DialogShell — wrapper opinativo do <Dialog> com paddings, max-width e
// estrutura header/body/footer ja definidos.
//
// PR-ANTIBUG (mai/2026): cada caller chutava w-[92vw] sm:max-w-Xl,
// rounded-2xl, p-0, max-h-[92vh], flex-col, gap-0... e dentro paddings
// px-5 py-3, px-5 py-4, px-5 pt-5 pb-3 — bug visual #190 (botoes colando
// nas bordas) nasceu disso. DialogShell impoe o layout certo de uma
// vez e remove a decisao individual.
//
// Uso:
//   <DialogShell open={open} onOpenChange={setOpen} size="lg" title="...">
//     <DialogShell.Body>... conteudo scrollavel ...</DialogShell.Body>
//     <DialogShell.Footer>
//       <Button variant="ghost">Cancelar</Button>
//       <Button>Salvar</Button>
//     </DialogShell.Footer>
//   </DialogShell>
//
// Diferencas vs <Dialog> + <DialogContent> nu:
//   - max-h: 92vh garantido (scroll interno ja funciona)
//   - rounded-2xl, overflow-hidden, flex-col, gap-0 — fixos
//   - px-6 horizontal em todos os slots — fim do drama de padding
//   - pr-12 no header pra reservar espaco do "x" absoluto
//   - py-4 + gap-3 no footer — botoes respiram

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { cn } from "../utils";

const SIZE_CLASSES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
} as const;

export interface DialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** sm 28rem | md 32rem | lg 42rem | xl 56rem */
  size?: keyof typeof SIZE_CLASSES;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Conteudo extra no header (badges, switches, etc) ao lado do titulo. */
  headerExtras?: React.ReactNode;
  /** Esconde o "x" do shadcn (ex: dialogo modal forcado). Default false. */
  hideCloseButton?: boolean;
  /** className extra no <DialogContent>. */
  className?: string;
  children: React.ReactNode;
}

function DialogShellRoot({
  open,
  onOpenChange,
  size = "lg",
  title,
  description,
  headerExtras,
  hideCloseButton = false,
  className,
  children,
}: DialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!hideCloseButton}
        className={cn(
          "w-[92vw] max-h-[92vh] p-0 flex flex-col rounded-2xl gap-0 overflow-hidden",
          SIZE_CLASSES[size],
          className,
        )}
      >
        <DialogHeader className="px-card pt-5 pb-3 pr-12 border-b border-border bg-card shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold">
                {title}
              </DialogTitle>
              {description && (
                <DialogDescription className="mt-1 text-xs">
                  {description}
                </DialogDescription>
              )}
            </div>
            {headerExtras && <div className="shrink-0">{headerExtras}</div>}
          </div>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

// --- Body slot ----------------------------------------------------------
// `flex-1 overflow-y-auto px-6 py-4` — scroll interno padronizado.
// Use `<DialogShell.Body className="space-y-6">` se precisar de spacing.
export interface DialogShellBodyProps
  extends React.HTMLAttributes<HTMLDivElement> {}

function DialogShellBody({
  className,
  children,
  ...props
}: DialogShellBodyProps) {
  return (
    <div
      data-slot="dialog-shell-body"
      className={cn("flex-1 overflow-y-auto px-card py-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}

// --- Footer slot --------------------------------------------------------
// `px-6 py-4 gap-3` — paddings garantidos. justify-between por default
// (Excluir esquerda + Salvar/Cancelar direita), trocar pra `justify="end"`
// se nao houver acao destrutiva.
export interface DialogShellFooterProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Default: "between" (Excluir esquerda + actions direita). */
  justify?: "between" | "end";
}

function DialogShellFooter({
  className,
  justify = "between",
  children,
  ...props
}: DialogShellFooterProps) {
  return (
    <div
      data-slot="dialog-shell-footer"
      // PR-FOOTER-RESPIRO (mai/2026): px-card-lg (32px) em vez de
      // px-card (24px) — Excluir esquerda e Salvar direita ficavam
      // quase colando nas bordas do dialog. Agora respiram mais.
      className={cn(
        "px-card-lg py-4 border-t border-border bg-card shrink-0 flex flex-row items-center gap-inline",
        justify === "between" ? "justify-between" : "justify-end",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// Composicao tipo dot-syntax: <DialogShell.Body /> / <DialogShell.Footer />.
// Mais legivel que importar DialogShellBody/Footer separados.
export const DialogShell = Object.assign(DialogShellRoot, {
  Body: DialogShellBody,
  Footer: DialogShellFooter,
});

// Re-exports nominais pra quem prefere import direto (sem dot-syntax).
export { DialogShellBody, DialogShellFooter };
