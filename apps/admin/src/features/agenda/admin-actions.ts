// Admin-side AgendaActions wiring.
//
// Server actions ja resolvem orgId via cookie admin-context (assinado).
// O wrapper mapeia 1-pra-1 no formato esperado pelo @persia/agenda-ui.
// Mesmo padrao do CRM (features/agenda/crm-actions.ts) — diferenca eh
// requireSuperadminForOrg em vez de requireRole + service-role bypassing
// RLS (mas todas as queries shared filtram por organization_id explicito).

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

export const adminAgendaActions: AgendaActions = {
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
};
