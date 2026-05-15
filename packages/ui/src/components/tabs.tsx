"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      // PR-DS-POLISH (mai/2026): contraste maior nas tabs.
      // Antes: hover so trocava texto (text-foreground/60 -> /100),
      // active so tinha shadow sutil. Agora:
      //   - hover bg-card/70: feedback visual claro mesmo nas inativas
      //   - active ring-1: borda sutil que confirma selecao
      //   - text /70 (era /60): inativos mais legiveis
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/70 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground hover:bg-card/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground dark:hover:bg-input/20 group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:hover:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground data-active:ring-1 data-active:ring-foreground/10 dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      // PR-B9 (auditoria E2E 2026-05-13, bug #16): @base-ui/react/tabs
      // marca panels inativos com o atributo `inert` (mas NAO aplica
      // CSS pra escondê-los). Browsers desativam interacao com inert
      // por padrao, mas mantem o elemento VISIVEL (display: block).
      // Resultado em prod: drawer com 4 tabs (Dados/Negócios/Campos/
      // Comentários) mostrava 2 panels ao mesmo tempo na troca, com
      // o conteudo dos dois sobrepondo verticalmente. Fix simétrico
      // com o pattern de TabsTrigger (que ja tinha visual state via
      // data-selected): adicionar `[&[inert]]:hidden` pra que o panel
      // inerte fique fora do fluxo visual.
      //
      // Tambem cobre `data-ending-style=""` (que vem durante uma
      // transition out de animation libraries) — Tailwind 4 aceita o
      // selector raw. Mantemos so `inert` pra simplicidade (atributo
      // estavel pre/pos-transition).
      className={cn(
        "flex-1 text-sm outline-none [&[inert]]:hidden",
        className,
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
