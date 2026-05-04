"use client";

// DialogHero (PR-K6.5) — header padrao pra Dialogs de formulario.
// Espelha o pattern do studio (referencia visual aprovada pelo
// usuario): box de icone colorido a esquerda + titulo grande +
// tagline em uppercase letterspaced.
//
// Uso dentro de qualquer <Dialog>:
//   <DialogContent>
//     <DialogHero
//       icon={<Save className="size-5" />}
//       title="Novo lead"
//       tagline="Preencha os detalhes abaixo"
//       tone="primary"
//     />
//     ... body do form ...
//   </DialogContent>
//
// Tons disponiveis:
//   - primary (azul/gold conforme tema) — default, criar/editar
//   - destructive (vermelho) — perda, exclusao
//   - success (verde) — fechamento positivo
//   - warning (ambar) — alertas
//
// O componente NAO renderiza o <DialogHeader> nem <DialogTitle>
// internos — ele e o titulo. So coloca dentro do DialogContent.

import * as React from "react";

export type DialogHeroTone =
  | "primary"
  | "destructive"
  | "success"
  | "warning";

const TONE_CLASSES: Record<DialogHeroTone, string> = {
  primary: "bg-primary text-primary-foreground",
  destructive:
    "bg-destructive/10 text-destructive dark:bg-destructive/20",
  success:
    "bg-emerald-500 text-white dark:bg-emerald-500/90",
  warning:
    "bg-amber-500 text-white dark:bg-amber-500/90",
};

export interface DialogHeroProps {
  /** Icone do box (ex: <Save className="size-5" />). */
  icon: React.ReactNode;
  /** Titulo do dialog (vai como h2). */
  title: string;
  /** Tagline em uppercase letterspaced abaixo do titulo. Opcional. */
  tagline?: string;
  /** Cor do box. Default: primary. */
  tone?: DialogHeroTone;
  /** Slot opcional pra ID/badge no canto direito. */
  trailing?: React.ReactNode;
}

export function DialogHero({
  icon,
  title,
  tagline,
  tone = "primary",
  trailing,
}: DialogHeroProps) {
  return (
    <div className="flex items-start gap-3 pb-1">
      <div
        className={`flex size-12 shrink-0 items-center justify-center rounded-xl shadow-sm ${TONE_CLASSES[tone]}`}
        aria-hidden
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        {/* Usa h2 explicito + DialogTitle wrapper sera adicionado pelo
            caller (manter compat com Radix a11y). */}
        <h2 className="truncate text-lg font-bold tracking-tight text-foreground">
          {title}
        </h2>
        {tagline && (
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
            {tagline}
          </p>
        )}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
