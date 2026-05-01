// Tradutores PT-BR pros enums internos da Agenda.
//
// Os enums em DB/types sao snake_case english (alinhados com Postgres
// conventions). A UI mostra labels em PT-BR. Esta camada centraliza a
// traducao pra evitar magic strings espalhadas em components.
//
// Tambem expoe colunas/cores tematicos pra cada status — usado em
// AppointmentStatusBadge, BookingPageStatusBadge etc.

import type {
  AppointmentChannel,
  AppointmentKind,
  AppointmentStatus,
  BookingPageStatus,
  CancellationRole,
} from "./types";

// ============================================================================
// Appointment status
// ============================================================================

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  awaiting_confirmation: "Aguardando confirmação",
  confirmed: "Confirmado",
  completed: "Realizado",
  cancelled: "Cancelado",
  no_show: "No-show",
  rescheduled: "Reagendado",
};

/**
 * Cor tematica do status (Tailwind tokens). Use no className do badge:
 *   `bg-${colorOf(status)}-100 text-${colorOf(status)}-700`
 * Ou monte mapas explicitos no componente — Tailwind nao processa
 * dinamico em string.
 */
export const APPOINTMENT_STATUS_COLORS: Record<
  AppointmentStatus,
  "amber" | "emerald" | "indigo" | "rose" | "slate" | "blue"
> = {
  awaiting_confirmation: "amber",
  confirmed: "emerald",
  completed: "indigo",
  cancelled: "rose",
  no_show: "slate",
  rescheduled: "blue",
};

// ============================================================================
// Appointment kind
// ============================================================================

export const APPOINTMENT_KIND_LABELS: Record<AppointmentKind, string> = {
  appointment: "Agendamento",
  event: "Evento",
  block: "Bloqueio",
};

// ============================================================================
// Appointment channel
// ============================================================================

export const APPOINTMENT_CHANNEL_LABELS: Record<AppointmentChannel, string> = {
  whatsapp: "WhatsApp",
  phone: "Telefone",
  online: "Online",
  in_person: "Presencial",
};

// ============================================================================
// Cancellation role
// ============================================================================

export const CANCELLATION_ROLE_LABELS: Record<CancellationRole, string> = {
  agent: "Agente",
  lead: "Lead",
  system: "Sistema",
};

// ============================================================================
// Booking page status
// ============================================================================

export const BOOKING_PAGE_STATUS_LABELS: Record<BookingPageStatus, string> = {
  draft: "Rascunho",
  active: "Ativa",
  inactive: "Inativa",
};

export const BOOKING_PAGE_STATUS_COLORS: Record<
  BookingPageStatus,
  "amber" | "emerald" | "slate"
> = {
  draft: "amber",
  active: "emerald",
  inactive: "slate",
};

// ============================================================================
// Helpers de formato (data/hora) — PT-BR / America/Sao_Paulo defaults.
// ============================================================================

/** "08:30" */
export function formatTime(iso: string, timezone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(iso));
}

/** "08:30 - 09:30" */
export function formatTimeRange(
  start_iso: string,
  end_iso: string,
  timezone = "America/Sao_Paulo",
): string {
  return `${formatTime(start_iso, timezone)} - ${formatTime(end_iso, timezone)}`;
}

/** "04/05/2026" */
export function formatDate(iso: string, timezone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(iso));
}

/** "segunda-feira" */
export function formatWeekday(
  iso: string,
  timezone = "America/Sao_Paulo",
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    timeZone: timezone,
  }).format(new Date(iso));
}

/** "4 de maio" */
export function formatDayMonth(
  iso: string,
  timezone = "America/Sao_Paulo",
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(new Date(iso));
}
