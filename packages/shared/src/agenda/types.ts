// Agenda — shared domain types.
//
// Source-of-truth alinhado com migration 031. Toda coluna do DB deve
// ter campo correspondente aqui em snake_case. Apps NAO devem definir
// types proprios pra Appointment/BookingPage/etc — sempre importam de
// `@persia/shared/agenda`.
//
// Consumidores:
//   - apps/crm/src/features/agenda/*       (server actions — Claude)
//   - packages/agenda-ui (futuro)          (UI components)
//   - apps/crm/src/app/(dashboard)/agenda  (routes)

// ============================================================================
// Discriminator + status enums — devem espelhar os CHECK constraints do DB
// ============================================================================

export const APPOINTMENT_KINDS = ["appointment", "event", "block"] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export const APPOINTMENT_STATUSES = [
  "awaiting_confirmation",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// Status que bloqueiam o slot no calculo de conflito/availability.
export const BLOCKING_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "awaiting_confirmation",
  "confirmed",
  "rescheduled",
];

export const APPOINTMENT_CHANNELS = [
  "whatsapp",
  "phone",
  "online",
  "in_person",
] as const;
export type AppointmentChannel = (typeof APPOINTMENT_CHANNELS)[number];

export const CANCELLATION_ROLES = ["agent", "lead", "system"] as const;
export type CancellationRole = (typeof CANCELLATION_ROLES)[number];

export const BOOKING_PAGE_STATUSES = ["draft", "active", "inactive"] as const;
export type BookingPageStatus = (typeof BOOKING_PAGE_STATUSES)[number];

export const APPOINTMENT_HISTORY_ACTIONS = [
  "created",
  "updated",
  "status_changed",
  "rescheduled",
  "cancelled",
  "restored",
  "confirmation_sent",
  "reminder_sent",
  "external_synced",
] as const;
export type AppointmentHistoryAction =
  (typeof APPOINTMENT_HISTORY_ACTIONS)[number];

export const HISTORY_PERFORMED_BY_ROLES = [
  "agent",
  "admin",
  "owner",
  "lead",
  "system",
] as const;
export type HistoryPerformedByRole = (typeof HISTORY_PERFORMED_BY_ROLES)[number];

// ============================================================================
// Availability — JSONB shape em availability_rules.days
// ============================================================================

// 0=domingo, 6=sabado. Alinhado com Date.prototype.getDay().
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AvailabilityInterval {
  /** "HH:mm" 24h, 00:00..23:59. Inclusivo. */
  start: string;
  /** "HH:mm" 24h, 00:00..24:00. Exclusivo. Pode ser "24:00" pra dia inteiro. */
  end: string;
}

export interface AvailabilityDay {
  day_of_week: DayOfWeek;
  enabled: boolean;
  intervals: AvailabilityInterval[];
}

// ============================================================================
// Row shapes — espelham as tabelas do DB
// ============================================================================

export interface AgendaService {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number | null;
  /** "#RRGGBB" ou null */
  color: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRule {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  /** IANA timezone (ex: "America/Sao_Paulo"). */
  timezone: string;
  default_duration_minutes: number;
  days: AvailabilityDay[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookingPage {
  id: string;
  organization_id: string;
  user_id: string;
  service_id: string | null;
  /** Unico por org. URL: /agendar/{org.slug}/{slug}. */
  slug: string;
  title: string;
  description: string | null;
  location: string | null;
  meeting_url: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  lookahead_days: number;
  status: BookingPageStatus;
  total_bookings: number;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  organization_id: string;
  kind: AppointmentKind;

  title: string;
  description: string | null;

  lead_id: string | null;
  user_id: string;
  service_id: string | null;
  booking_page_id: string | null;

  /** ISO 8601 com timezone (UTC no DB; apps convertem pra local). */
  start_at: string;
  end_at: string;
  duration_minutes: number;
  /** IANA timezone do agendamento (pra conferir slot no fuso correto). */
  timezone: string;

  status: AppointmentStatus;
  channel: AppointmentChannel | null;
  location: string | null;
  meeting_url: string | null;

  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
  cancelled_by_role: CancellationRole | null;
  cancellation_reason: string | null;
  rescheduled_from_id: string | null;

  confirmation_sent_at: string | null;
  reminder_sent_at: string | null;

  /** FK pra agent_calendar_connections (migration 026). */
  external_calendar_connection_id: string | null;
  external_event_id: string | null;
  external_synced_at: string | null;

  /** RFC 5545 RRULE — reservado pra v2. */
  recurrence_rule: string | null;

  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AppointmentHistoryEntry {
  id: string;
  appointment_id: string;
  organization_id: string;
  action: AppointmentHistoryAction;
  metadata: Record<string, unknown>;
  performed_by_user_id: string | null;
  performed_by_role: HistoryPerformedByRole | null;
  created_at: string;
}

// ============================================================================
// Insert/Update shapes — campos opcionais com default no DB sao opcionais aqui
// ============================================================================

export type AppointmentInsert = Omit<
  Appointment,
  | "id"
  | "created_at"
  | "updated_at"
  | "deleted_at"
  | "cancelled_at"
  | "cancelled_by_user_id"
  | "cancelled_by_role"
  | "cancellation_reason"
  | "rescheduled_from_id"
  | "confirmation_sent_at"
  | "reminder_sent_at"
  | "external_calendar_connection_id"
  | "external_event_id"
  | "external_synced_at"
  | "recurrence_rule"
> &
  Partial<
    Pick<
      Appointment,
      | "cancelled_at"
      | "cancelled_by_user_id"
      | "cancelled_by_role"
      | "cancellation_reason"
      | "rescheduled_from_id"
      | "external_calendar_connection_id"
      | "external_event_id"
      | "recurrence_rule"
    >
  >;

export type AppointmentUpdate = Partial<
  Omit<Appointment, "id" | "organization_id" | "created_at">
>;

// ============================================================================
// Query shapes
// ============================================================================

export interface AppointmentsRangeQuery {
  /** ISO inicio inclusivo. */
  from: string;
  /** ISO fim exclusivo. */
  to: string;
  user_id?: string;
  lead_id?: string;
  kinds?: readonly AppointmentKind[];
  statuses?: readonly AppointmentStatus[];
  /** Default: false (esconde soft-deleted). */
  include_deleted?: boolean;
}

// ============================================================================
// Type guards / pequenas utilidades de tipo
// ============================================================================

export function isAppointmentKind(x: unknown): x is AppointmentKind {
  return (
    typeof x === "string" &&
    (APPOINTMENT_KINDS as readonly string[]).includes(x)
  );
}

export function isAppointmentStatus(x: unknown): x is AppointmentStatus {
  return (
    typeof x === "string" &&
    (APPOINTMENT_STATUSES as readonly string[]).includes(x)
  );
}

export function isDayOfWeek(x: unknown): x is DayOfWeek {
  return typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 6;
}
