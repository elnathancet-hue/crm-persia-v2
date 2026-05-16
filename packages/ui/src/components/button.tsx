"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        // Regra global DS (mai/2026): nao existe botao "branco" nem "cinza".
        // outline = contorno azul + texto azul + fundo transparente, hover azul/10
        outline:
          "border-primary text-primary bg-transparent hover:bg-primary/10 hover:text-primary aria-expanded:bg-primary/10 aria-expanded:text-primary",
        // secondary continua existindo como variante "tom suave" da brand
        secondary:
          "bg-primary/10 text-primary hover:bg-primary/15 aria-expanded:bg-primary/15",
        // ghost = sem contorno, texto azul, hover azul/10
        ghost:
          "text-primary hover:bg-primary/10 hover:text-primary aria-expanded:bg-primary/10 aria-expanded:text-primary",
        // Regra global DS (mai/2026): destructive solido (era /10 fraco).
        // Usado em "Marcar como perdido", "Excluir", "Descartar" — precisa
        // contraste alto pra denotar gravidade.
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/50 focus-visible:ring-destructive/30 dark:focus-visible:ring-destructive/40",
        // Success solido — usado em "Negocio fechado / Marcar como ganho".
        // Pareado com destructive (mesmo peso visual, intencao oposta).
        success:
          "bg-success text-success-foreground hover:bg-success/90 focus-visible:border-success/50 focus-visible:ring-success/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // PR-DS-POLISH (mai/2026): bumpa Button default de h-8 pra h-9 +
      // px-3 — alinha com Input/Textarea/Select default. Antes botoes
      // ficavam visualmente menores que campos ao lado (toolbar/footer).
      // Demais sizes seguem a escala proporcional.
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs":
          "size-7 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
