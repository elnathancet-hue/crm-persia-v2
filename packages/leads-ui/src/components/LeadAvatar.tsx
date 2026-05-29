"use client";

// Avatar reusable pros componentes de lead.
//
// mai/2026: cliente reportou que "o lead nao puxa" foto. Causa
// raiz era duas:
//   1. Coluna leads.avatar_url ja era populada (via getContactProfilePic
//      no incoming-pipeline.ts), mas NENHUM componente UI renderizava.
//   2. Leads antigos / casos de erro ficavam sem foto e nao tinham
//      jeito de re-tentar manualmente.
//
// Este componente resolve (1) — render do avatar com fallback de
// iniciais coloridas. O botao de "Atualizar foto" do drawer cuida
// de (2) chamando a action refreshLeadAvatar.

import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@persia/ui/button";
import { cn } from "@persia/ui/utils";

interface LeadAvatarProps {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  /** Tamanho do avatar — padroes pra UI list (sm), card (md) ou
   *  header do drawer (lg). */
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<LeadAvatarProps["size"]>, string> = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
  xl: "size-16 text-base",
};

/**
 * Iniciais do nome — pega ate 2 letras das 2 primeiras palavras.
 * "Elnathan NICOLAS" -> "EN"
 * "Maria"            -> "MA"
 * ""/null            -> "?"
 */
export function leadInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Cor de fundo deterministica baseada no nome — leads diferentes
 * tem cores diferentes mas o MESMO lead sempre tem a mesma cor.
 * Usa hash simples + paleta de tokens semanticos.
 */
function colorFromName(name: string | null | undefined): string {
  const text = name?.trim() || "?";
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0; // int32
  }
  const palette = [
    "bg-primary/15 text-primary",
    "bg-success-soft text-success-soft-foreground",
    "bg-progress-soft text-progress-soft-foreground",
    "bg-destructive/15 text-destructive",
    "bg-muted text-muted-foreground",
  ];
  return palette[Math.abs(hash) % palette.length]!;
}

export function LeadAvatar({
  name,
  avatarUrl,
  size = "md",
  className,
}: LeadAvatarProps) {
  const [imgErrored, setImgErrored] = React.useState(false);
  const sizeClass = SIZE_CLASSES[size];

  // Render img quando temos URL e a img nao deu erro de load.
  // Sem isso, leads com URL inválida ficam com placeholder vazio.
  if (avatarUrl && !imgErrored) {
    return (
      <img
        src={avatarUrl}
        alt={name || "Lead"}
        loading="lazy"
        onError={() => setImgErrored(true)}
        className={cn(
          "rounded-full object-cover shrink-0 border border-border/40",
          sizeClass,
          className,
        )}
      />
    );
  }

  // Fallback: iniciais coloridas. Cor deterministica pra mesmo lead
  // ter mesma cor em qualquer tela.
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-semibold shrink-0",
        sizeClass,
        colorFromName(name),
        className,
      )}
      aria-label={name || "Lead sem nome"}
    >
      {leadInitials(name)}
    </div>
  );
}

interface LeadAvatarWithRefreshProps extends LeadAvatarProps {
  /** Telefone WhatsApp do lead — sem ele, o botao desabilita. */
  hasPhone: boolean;
  /** Quando true, mostra loader no botao. Caller controla. */
  loading?: boolean;
  /** Disparado quando cliente clica em "atualizar foto WhatsApp".
   *  Componente nao chama a action diretamente — caller faz +
   *  controla loading + toast. */
  onRefresh: () => void;
}

/**
 * Variante do avatar com botão de "Atualizar foto" sobreposto. Usado
 * no header do drawer pra leads antigos / casos onde a primeira
 * tentativa de fetch falhou.
 */
export function LeadAvatarWithRefresh({
  hasPhone,
  loading,
  onRefresh,
  ...avatarProps
}: LeadAvatarWithRefreshProps) {
  return (
    <div className="relative inline-block">
      <LeadAvatar {...avatarProps} />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={onRefresh}
        disabled={!hasPhone || loading}
        title={
          !hasPhone
            ? "Sem telefone — nao da pra puxar foto"
            : loading
              ? "Atualizando..."
              : "Atualizar foto do WhatsApp"
        }
        className="absolute -bottom-1 -right-1 size-6 rounded-full p-0 bg-card shadow-sm"
        aria-label="Atualizar foto do WhatsApp"
      >
        {loading ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <RefreshCw className="size-3" />
        )}
      </Button>
    </div>
  );
}
