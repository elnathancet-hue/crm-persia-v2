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
