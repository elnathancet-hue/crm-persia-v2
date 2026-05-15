"use client";

// StatusBadge / HealthDot / ChannelBadge — primitives semanticos pra
// estados visuais que estavam estilizados localmente em chat/CRM/
// settings/automations.
//
// PR-AUDIT (mai/2026): cada feature reinventava badges pra status
// (ativo/inativo/conectado/aguardando/erro) e canais (WhatsApp/Email/
// SMS/IA/Humano). Drift visual + sem semantica central. Agora 3
// primitives consolidam.

import * as React from "react";
import { cn } from "../utils";
import {
  Bot,
  Check,
  CircleAlert,
  CircleDashed,
  Mail,
  MessageSquare,
  Phone,
  User as UserIcon,
} from "lucide-react";

// ============================================================================
// StatusBadge — badge pill com cor semantica do outcome
// ============================================================================

export type StatusKind =
  | "success" // ativo / conectado / OK
  | "failure" // erro / desconectado / falha
  | "warning" // aguardando / pausa / atencao
  | "progress" // em andamento / processando
  | "neutral"; // inativo / rascunho / pausado

interface StatusBadgeProps {
  kind: StatusKind;
  children: React.ReactNode;
  /** Se true, mostra dot prefix. Default true. */
  showDot?: boolean;
  size?: "sm" | "default";
  className?: string;
}

const STATUS_BADGE_CLASSES: Record<StatusKind, string> = {
  success: "bg-success-soft text-success-soft-foreground ring-success-ring",
  failure: "bg-failure-soft text-failure-soft-foreground ring-failure-ring",
  warning: "bg-warning-soft text-warning-soft-foreground ring-warning-ring",
  progress: "bg-progress-soft text-progress-soft-foreground ring-progress-ring",
  neutral: "bg-muted text-muted-foreground ring-border",
};

const STATUS_DOT_CLASSES: Record<StatusKind, string> = {
  success: "bg-success",
  failure: "bg-failure",
  warning: "bg-warning",
  progress: "bg-progress",
  neutral: "bg-muted-foreground/60",
};

export function StatusBadge({
  kind,
  children,
  showDot = true,
  size = "default",
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        STATUS_BADGE_CLASSES[kind],
        className,
      )}
    >
      {showDot && (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full shrink-0", STATUS_DOT_CLASSES[kind])}
        />
      )}
      {children}
    </span>
  );
}

// ============================================================================
// HealthDot — dot pulsante pra indicador de conexao/saude (online indicator)
// ============================================================================

export type HealthState = "online" | "degraded" | "offline" | "idle";

interface HealthDotProps {
  state: HealthState;
  /** Mostra ping/pulse animation quando online. Default true. */
  pulse?: boolean;
  size?: "sm" | "default" | "lg";
  /** Texto ao lado do dot (opcional). */
  label?: React.ReactNode;
  className?: string;
}

const HEALTH_COLOR: Record<HealthState, string> = {
  online: "bg-success",
  degraded: "bg-warning",
  offline: "bg-failure",
  idle: "bg-muted-foreground/60",
};

const HEALTH_SIZE: Record<"sm" | "default" | "lg", string> = {
  sm: "size-1.5",
  default: "size-2",
  lg: "size-2.5",
};

export function HealthDot({
  state,
  pulse = true,
  size = "default",
  label,
  className,
}: HealthDotProps) {
  const showPulse = pulse && state === "online";
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("relative inline-flex shrink-0", HEALTH_SIZE[size])}>
        {showPulse && (
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 animate-ping rounded-full opacity-60",
              HEALTH_COLOR[state],
            )}
          />
        )}
        <span
          aria-hidden
          className={cn("relative inline-flex w-full h-full rounded-full", HEALTH_COLOR[state])}
        />
      </span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  );
}

// ============================================================================
// ChannelBadge — badge fixa por canal (WhatsApp/Email/SMS/IA/Humano/etc)
// ============================================================================

export type ChannelKind =
  | "whatsapp" // verde
  | "email" // azul (primary)
  | "sms" // chart-2
  | "ai" // progress (purple)
  | "human" // foreground
  | "phone"; // chart-3

interface ChannelBadgeProps {
  kind: ChannelKind;
  /** Texto custom; default = nome canonico do canal. */
  label?: React.ReactNode;
  size?: "sm" | "default";
  /** Renderiza icone do canal. Default true. */
  showIcon?: boolean;
  className?: string;
}

const CHANNEL_META: Record<
  ChannelKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; classes: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    icon: MessageSquare,
    classes: "bg-success-soft text-success-soft-foreground",
  },
  email: {
    label: "Email",
    icon: Mail,
    classes: "bg-primary/10 text-primary",
  },
  sms: {
    label: "SMS",
    icon: Phone,
    classes: "bg-chart-2/15 text-chart-2",
  },
  ai: {
    label: "IA",
    icon: Bot,
    classes: "bg-progress-soft text-progress-soft-foreground",
  },
  human: {
    label: "Humano",
    icon: UserIcon,
    classes: "bg-muted text-foreground",
  },
  phone: {
    label: "Telefone",
    icon: Phone,
    classes: "bg-chart-3/15 text-chart-3",
  },
};

export function ChannelBadge({
  kind,
  label,
  size = "default",
  showIcon = true,
  className,
}: ChannelBadgeProps) {
  const meta = CHANNEL_META[kind];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        meta.classes,
        className,
      )}
    >
      {showIcon && <Icon className="size-3 shrink-0" />}
      {label ?? meta.label}
    </span>
  );
}

// ============================================================================
// Re-export icons (pra StatusBadge consumers que querem icone customizado)
// ============================================================================

export const StatusIcons = {
  success: Check,
  failure: CircleAlert,
  warning: CircleAlert,
  progress: CircleDashed,
};
