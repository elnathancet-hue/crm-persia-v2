// Dependency injection da Agenda UI.
//
// Apps (crm, admin) constroem um objeto AgendaActions concreto apontando
// pras suas server actions e injetam via <AgendaActionsProvider>. Os
// componentes shared NUNCA importam `@/actions/*` direto — pegam atraves
// de `useAgendaActions()`.
//
// Assinaturas alinhadas com apps/crm/src/actions/agenda/*. Admin pode
// curry orgId/usar requireSuperadminForOrg antes de expor.

import type {
  AgendaService,
  Appointment,
  AppointmentStatus,
  AvailabilityRule,
  BookingPage,
  CancelAppointmentInput,
  CreateAgendaServiceInput,
  CreateAppointmentInput,
  CreateAvailabilityRuleInput,
  CreateBookingPageInput,
  ListAppointmentsFilters,
  ListBookingPagesFilters,
  ListServicesFilters,
  RescheduleAppointmentInput,
  UpdateAgendaServiceInput,
  UpdateAppointmentInput,
  UpdateAvailabilityRuleInput,
  UpdateBookingPageInput,
} from "@persia/shared/agenda";

export interface AgendaActions {
  // Appointments
  getAppointments: (filters?: ListAppointmentsFilters) => Promise<Appointment[]>;
  getAppointmentById: (id: string) => Promise<Appointment | null>;
  createAppointment: (
    input: Omit<CreateAppointmentInput, "user_id"> & { user_id?: string },
  ) => Promise<Appointment>;
  updateAppointment: (
    id: string,
    input: UpdateAppointmentInput,
  ) => Promise<Appointment>;
  updateAppointmentStatus: (
    id: string,
    status: AppointmentStatus,
  ) => Promise<Appointment>;
  cancelAppointment: (
    id: string,
    input?: CancelAppointmentInput,
  ) => Promise<Appointment>;
  rescheduleAppointment: (
    id: string,
    input: RescheduleAppointmentInput,
  ) => Promise<{ original: Appointment; replacement: Appointment }>;
  deleteAppointment: (id: string) => Promise<void>;
  restoreAppointment: (id: string) => Promise<Appointment>;

  // Services
  getAgendaServices: (filters?: ListServicesFilters) => Promise<AgendaService[]>;
  getAgendaServiceById: (id: string) => Promise<AgendaService | null>;
  createAgendaService: (input: CreateAgendaServiceInput) => Promise<AgendaService>;
  updateAgendaService: (
    id: string,
    input: UpdateAgendaServiceInput,
  ) => Promise<AgendaService>;
  deleteAgendaService: (id: string) => Promise<void>;

  // Availability Rules
  getAvailabilityRules: (filters?: {
    user_id?: string;
  }) => Promise<AvailabilityRule[]>;
  getAvailabilityRuleById: (id: string) => Promise<AvailabilityRule | null>;
  getDefaultAvailabilityRule: (
    user_id?: string,
  ) => Promise<AvailabilityRule | null>;
  createAvailabilityRule: (
    input: Omit<CreateAvailabilityRuleInput, "user_id"> & { user_id?: string },
  ) => Promise<AvailabilityRule>;
  updateAvailabilityRule: (
    id: string,
    input: UpdateAvailabilityRuleInput,
  ) => Promise<AvailabilityRule>;
  deleteAvailabilityRule: (id: string) => Promise<void>;

  // Booking Pages
  getBookingPages: (filters?: ListBookingPagesFilters) => Promise<BookingPage[]>;
  getBookingPageById: (id: string) => Promise<BookingPage | null>;
  createBookingPage: (
    input: Omit<CreateBookingPageInput, "user_id"> & { user_id?: string },
  ) => Promise<BookingPage>;
  updateBookingPage: (
    id: string,
    input: UpdateBookingPageInput,
  ) => Promise<BookingPage>;
  duplicateBookingPage: (id: string, new_slug: string) => Promise<BookingPage>;
  deleteBookingPage: (id: string) => Promise<void>;
}

// Tipos auxiliares pro callbacks que componentes vao expor pra UI parent
// (ex: abrir lead detail quando clicam no nome do lead num appointment).
// Mesmo padrao do AgentActions, separado pra nao misturar mutations server
// com side-effects locais.
export interface AgendaCallbacks {
  /** Abre o detalhe do lead na tela parent. */
  onOpenLead?: (leadId: string) => void;
  /** Abre o chat do lead. */
  onOpenChat?: (leadId: string) => void;
  /** Notifica o parent que houve mudanca (refresh externo, etc). */
  onAppointmentChange?: (appointmentId: string) => void;
}
