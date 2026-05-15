"use client";

// ActionMenu — wrapper opinativo do DropdownMenu pra menus de acao (3-dot
// kebab). Pattern PR-A (mai/2026 — mockup ChatGPT):
//
//   1. Trigger e o proprio Button icon (passado via render prop)
//   2. Items tem padding generoso (px-3 py-2.5 vs default px-2 py-1.5)
//   3. Items aceitam icon explicito (alinhado em coluna fixa)
//   4. Acoes destrutivas vivem em <ActionMenu.Destructive> — render
//      automatico com separator visual antes do bloco
//   5. Container rounded-2xl + ring sutil — alinha com o resto do DS
//
// Uso:
//   <ActionMenu trigger={<Button variant="ghost" size="icon-sm" aria-label="Ações"><MoreHorizontal /></Button>}>
//     <ActionMenu.Item icon={Eye} onClick={...}>Ver detalhes</ActionMenu.Item>
//     <ActionMenu.Item icon={Pencil} onClick={...}>Editar</ActionMenu.Item>
//     <ActionMenu.Destructive icon={Trash2} onClick={...}>Excluir</ActionMenu.Destructive>
//   </ActionMenu>
//
// Diferenca do DropdownMenu cru: o caller nao precisa lembrar de
// (a) por separator antes do destructive, (b) aplicar text-destructive,
// (c) escolher padding consistente. Tudo baked-in.

import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { cn } from "../utils";

export interface ActionMenuProps {
  /** Elemento clickavel que abre o menu (geralmente um Button icon). */
  trigger: React.ReactNode;
  /** Itens — use <ActionMenu.Item> e <ActionMenu.Destructive>. */
  children: React.ReactNode;
  /** Alinhamento do popup. Default: end (alinhado ao lado direito do trigger). */
  align?: "start" | "center" | "end";
  /** Largura minima do popup. Default 12rem (~190px). */
  className?: string;
}

interface ActionMenuItemProps {
  /** Icone Lucide ou similar (componente). Renderiza em size-4 muted. */
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  /** Se true, fica desabilitado. */
  disabled?: boolean;
  children: React.ReactNode;
}

function ActionMenuRoot({
  trigger,
  children,
  align = "end",
  className,
}: ActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger as React.ReactElement} />
      <DropdownMenuContent
        align={align}
        className={cn(
          // PR-A: padding generoso + rounded mais arredondado que default
          "min-w-48 rounded-2xl p-1.5 shadow-lg",
          className,
        )}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionMenuItem({ icon: Icon, onClick, disabled, children }: ActionMenuItemProps) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      disabled={disabled}
      // Padding mais generoso que o default + gap consistente
      className="gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer focus:bg-muted"
    >
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate">{children}</span>
    </DropdownMenuItem>
  );
}

function ActionMenuDestructive({ icon: Icon, onClick, disabled, children }: ActionMenuItemProps) {
  // PR-A: destrutivo sempre vem precedido de separator visual.
  // Caller nao precisa lembrar de adicionar <Separator /> manualmente.
  return (
    <>
      <DropdownMenuSeparator className="my-1" />
      <DropdownMenuItem
        onClick={onClick}
        disabled={disabled}
        className="gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
      >
        {Icon && <Icon className="size-4 shrink-0 text-destructive" />}
        <span className="flex-1 truncate">{children}</span>
      </DropdownMenuItem>
    </>
  );
}

/**
 * Composicao dot-syntax:
 *   <ActionMenu.Item icon={Eye}>...</ActionMenu.Item>
 *   <ActionMenu.Destructive icon={Trash2}>...</ActionMenu.Destructive>
 */
export const ActionMenu = Object.assign(ActionMenuRoot, {
  Item: ActionMenuItem,
  Destructive: ActionMenuDestructive,
});

export { ActionMenuItem, ActionMenuDestructive };
