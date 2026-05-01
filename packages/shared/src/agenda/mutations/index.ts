// Barrel das mutations da Agenda.

export type { InsertHistoryArgs } from "./history";
export { insertHistory } from "./history";

export {
  AppointmentConflictError,
  AppointmentValidationError,
  createAppointment,
  updateAppointment,
  updateAppointmentStatus,
  cancelAppointment,
  rescheduleAppointment,
  softDeleteAppointment,
  restoreAppointment,
} from "./appointments";
export type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
  CancelAppointmentInput,
  RescheduleAppointmentInput,
} from "./appointments";

export {
  createAgendaService,
  updateAgendaService,
  deleteAgendaService,
} from "./services";
export type {
  CreateAgendaServiceInput,
  UpdateAgendaServiceInput,
} from "./services";

export {
  createAvailabilityRule,
  updateAvailabilityRule,
  deleteAvailabilityRule,
} from "./availability-rules";
export type {
  CreateAvailabilityRuleInput,
  UpdateAvailabilityRuleInput,
} from "./availability-rules";

export {
  BookingPageSlugError,
  createBookingPage,
  updateBookingPage,
  duplicateBookingPage,
  deleteBookingPage,
} from "./booking-pages";
export type {
  CreateBookingPageInput,
  UpdateBookingPageInput,
} from "./booking-pages";
