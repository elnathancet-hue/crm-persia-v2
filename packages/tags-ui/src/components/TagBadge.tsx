"use client";

// TagBadge — UMA fonte de verdade pra renderizar tag.
//
// PR-ANTIBUG (mai/2026): existia o componente mas LeadInfoDrawer (e
// outros) reinventaram inline com style={{ borderColor: `${tag.color}40` }}
// — bug visual onde todas as tags pareciam azul porque a cor crua nao
// destacava. Solucao: aceitar `tag={tag}` direto E manter o callsite
// curto pra desestimular re-implementacao.
//
// Uso:
//   <TagBadge tag={tag} />
//   <TagBadge tag={tag} onRemove={() => ...} />
//   <TagBadge tag={tag} variant="soft" />     // fundo translucido
//   <TagBadge name="Custom" color="#fab" />   // shape antigo, retro-compat

import { cn } from "@persia/ui/utils";
import { X } from "lucide-react";

interface TagShape {
  name: string;
  color: string;
}

interface TagBadgeProps {
  /** Forma curta — passar a tag inteira. Preferida. */
  tag?: TagShape;
  /** Forma longa (legado) — name+color separados. */
  name?: string;
  color?: string;
  /** "solid" (default) bg cheio + texto contrastante. "soft" bg translucido. */
  variant?: "solid" | "soft";
  onRemove?: () => void;
  className?: string;
  size?: "sm" | "default";
}

function getContrastColor(hex: string): string {
  // Aceita #RGB, #RRGGBB, #RRGGBBAA. Fallback escuro pra cores invalidas.
  const c = (hex || "").replace("#", "");
  if (c.length !== 3 && c.length !== 6 && c.length !== 8) return "#1f2937";
  const full = c.length === 3 ? c.split("").map((x) => x + x).join("") : c.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "#1f2937";
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#ffffff";
}

export function TagBadge({
  tag,
  name: nameProp,
  color: colorProp,
  variant = "solid",
  onRemove,
  className,
  size = "default",
}: TagBadgeProps) {
  // Resolve via tag={...} OU props soltos. Default cinza neutro pra
  // tag sem cor (evita transparente bizarro).
  const name = tag?.name ?? nameProp ?? "";
  const color = tag?.color || colorProp || "#94a3b8"; // slate-400 fallback

  const style =
    variant === "soft"
      ? {
          // PR-ANTIBUG: fundo soft (~25% alpha) + texto na cor cheia.
          // Substitui o inline `${tag.color}20`/`${tag.color}40` reinventado.
          backgroundColor: `${color}26`, // 0x26 ≈ 15%
          color,
          borderColor: `${color}66`,
        }
      : {
          backgroundColor: color,
          color: getContrastColor(color),
        };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap",
        variant === "soft" && "border",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        className,
      )}
      style={style}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remover tag ${name}`}
          className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/20"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
