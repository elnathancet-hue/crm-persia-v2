// Public surface of @persia/shared/agenda
//
// Importado tanto por apps/crm (cliente final) quanto por apps/admin
// (superadmin), pra garantir que os dois apps falem do mesmo modelo de
// agendamento. Toda mudanca aqui afeta os 2 — testar nos 2 typechecks
// antes de mergear.

export type {
  AppointmentKind,
  AppointmentStatus,
  AppointmentChannel,
  CancellationRole,
  BookingPageStatus,
  AppointmentHistoryAction,
  HistoryPerformedByRole,
  DayOfWeek,
  AvailabilityInterval,
  AvailabilityDay,
  AgendaService,
  AvailabilityRule,
  BookingPage,
  Appointment,
  AppointmentHistoryEntry,
  AppointmentInsert,
  AppointmentUpdate,
  AppointmentsRangeQuery,
} from "./types";

export {
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
  BLOCKING_APPOINTMENT_STATUSES,
  APPOINTMENT_CHANNELS,
  CANCELLATION_ROLES,
  BOOKING_PAGE_STATUSES,
  APPOINTMENT_HISTORY_ACTIONS,
  HISTORY_PERFORMED_BY_ROLES,
  isAppointmentKind,
  isAppointmentStatus,
  isDayOfWeek,
} from "./types";

export type { GetAvailableSlotsInput, AvailableSlot } from "./availability";

export {
  getZonedTime,
  timeStringToMinutes,
  minutesToTimeString,
  findScheduleConflict,
  isWithinAvailability,
  getAvailableSlots,
  projectLocalToUtc,
  getTimezoneOffsetMinutes,
} from "./availability";

// Queries — leitura compartilhada entre apps. Cada app passa { db, orgId }
// depois de fazer auth (requireRole no CRM, requireSuperadminForOrg no admin).
export * from "./queries";

// Mutations — escrita compartilhada com validacao server-side (conflito,
// availability) + appointment_history automatico.
export * from "./mutations";

// Labels (PT-BR) + helpers de formato. Usado pela UI pra evitar magic
// strings e centralizar tradutores dos enums internos snake_case english.
export * from "./labels";

// Reminders — types, defaults e template renderer pra lembretes WhatsApp.
// Cron tick + dispatcher vivem em apps/crm/src/lib/agenda/reminders/.
export * from "./reminders";
