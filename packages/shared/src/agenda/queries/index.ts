// Barrel das queries da Agenda. Subpath:
//   import { listAppointments } from "@persia/shared/agenda";

export type {
  AgendaQueryContext,
  AgendaMutationContext,
  AgendaQueryDb,
} from "./context";

export type { ListAppointmentsFilters } from "./appointments";
export {
  listAppointments,
  getAppointment,
  listConflictCandidates,
} from "./appointments";

export type { ListServicesFilters } from "./services";
export { listAgendaServices, getAgendaService } from "./services";

export {
  listAvailabilityRules,
  getAvailabilityRule,
  getDefaultAvailabilityRule,
} from "./availability-rules";

export type {
  ListBookingPagesFilters,
  BookingPagePublicResolved,
} from "./booking-pages";
export {
  listBookingPages,
  getBookingPage,
  getBookingPagePublicBySlug,
} from "./booking-pages";
