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
// PR-AGENDA-LAST-MSG (mai/2026): tipo da ultima mensagem do lead exposto
// pelo AppointmentDrawer. Vem do CRM shared (messages e entidade do CRM,
// nao da Agenda — Agenda so consome).
import type { LeadLastMessagePreview } from "@persia/shared/crm";

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

  // PR-AGENDA-LAST-MSG (mai/2026): ultima mensagem do lead pra mostrar
  // contexto inline no AppointmentDrawer. Opcional — admin pode nao
  // implementar e a secao some.
  getLeadLastMessage?: (leadId: string) => Promise<LeadLastMessagePreview | null>;
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
  /** Busca leads pra autocomplete em forms. App-injected pra evitar
   *  acoplar agenda-ui ao tipo Lead do CRM. Default: undefined (sem
   *  autocomplete; LeadSearchSelect mostra so um input desabilitado). */
  searchLeads?: (query: string, limit?: number) => Promise<LeadOption[]>;
  /** Lista de usuarios da org pra preencher select 'Responsavel' nos forms.
   *  App fetcha 1x ao montar a tela. Default: array vazio (so o user
   *  corrente fica disponivel; admin/owner nao consegue assignar pra terceiro). */
  agendaUsers?: AgendaUserOption[];
  /** UUID do user logado. Usado como default em 'Responsavel' nos forms. */
  currentUserId?: string;
}

/** Forma minima que LeadSearchSelect espera retornar do `searchLeads`. */
export interface LeadOption {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
}

/** Forma minima que selects de 'Responsavel' esperam. */
export interface AgendaUserOption {
  id: string;
  name: string;
  email?: string | null;
}
