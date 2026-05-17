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

// PR-KANBAN-UPCOMING (mai/2026): destaque visual no Kanban pra leads
// com appointment proximo. Query separada da do Kanban pra nao
// adicionar JOIN custoso na query principal.
export type { LeadUpcomingAppointment } from "./upcoming-by-lead";
export { findUpcomingAppointmentsByLeads } from "./upcoming-by-lead";
