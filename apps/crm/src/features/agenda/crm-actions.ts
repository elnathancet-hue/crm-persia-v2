// CRM-side AgendaActions wiring.
//
// Server actions ja resolvem orgId via cookie da sessao (requireRole). O
// wrapper so mapeia 1-pra-1 no formato esperado pelo @persia/agenda-ui.
// O admin faz o equivalente em apps/admin com requireSuperadminForOrg
// quando expor a UI da Agenda.

import type { AgendaActions } from "@persia/agenda-ui";
import {
  cancelAppointment,
  createAppointment,
  deleteAppointment,
  getAppointmentById,
  getAppointments,
  rescheduleAppointment,
  restoreAppointment,
  updateAppointment,
  updateAppointmentStatus,
} from "@/actions/agenda/appointments";
import {
  createAgendaService,
  deleteAgendaService,
  getAgendaServiceById,
  getAgendaServices,
  updateAgendaService,
} from "@/actions/agenda/services";
import {
  createAvailabilityRule,
  deleteAvailabilityRule,
  getAvailabilityRuleById,
  getAvailabilityRules,
  getDefaultAvailabilityRule,
  updateAvailabilityRule,
} from "@/actions/agenda/availability";
import {
  createBookingPage,
  deleteBookingPage,
  duplicateBookingPage,
  getBookingPageById,
  getBookingPages,
  updateBookingPage,
} from "@/actions/agenda/booking-pages";
// PR-AGENDA-LAST-MSG (mai/2026): ultima mensagem do lead pro
// AppointmentDrawer. Vem de actions/messages (entidade CRM, nao da Agenda).
import { getLeadLastMessage } from "@/actions/messages";

export const crmAgendaActions: AgendaActions = {
  // Appointments
  getAppointments,
  getAppointmentById,
  createAppointment,
  updateAppointment,
  updateAppointmentStatus,
  cancelAppointment,
  rescheduleAppointment,
  deleteAppointment,
  restoreAppointment,
  // Services
  getAgendaServices,
  getAgendaServiceById,
  createAgendaService,
  updateAgendaService,
  deleteAgendaService,
  // Availability
  getAvailabilityRules,
  getAvailabilityRuleById,
  getDefaultAvailabilityRule,
  createAvailabilityRule,
  updateAvailabilityRule,
  deleteAvailabilityRule,
  // Booking pages
  getBookingPages,
  getBookingPageById,
  createBookingPage,
  updateBookingPage,
  duplicateBookingPage,
  deleteBookingPage,
  // PR-AGENDA-LAST-MSG (mai/2026)
  getLeadLastMessage,
};
