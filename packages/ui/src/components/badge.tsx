import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        // Regra global DS (mai/2026): nao existe badge "branco" nem "cinza".
        // secondary = tom suave da brand
        secondary:
          "bg-primary/10 text-primary [a]:hover:bg-primary/15",
        // Regra global DS (mai/2026): destructive solido (era /10 fraco).
        destructive:
          "bg-destructive text-destructive-foreground focus-visible:ring-destructive/30 [a]:hover:bg-destructive/90",
        // Success solido — par com destructive. Usado em "Ganho", "Concluido".
        success:
          "bg-success text-success-foreground focus-visible:ring-success/30 [a]:hover:bg-success/90",
        // outline = contorno azul + texto azul + fundo transparente
        outline:
          "border-primary text-primary [a]:hover:bg-primary/10",
        // ghost = sem contorno, texto azul, hover azul/10
        ghost:
          "text-primary hover:bg-primary/10",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
