// @persia/agenda-ui — shared Agenda UI surface.
//
// Apps (crm, admin) consomem estes componentes via
// <AgendaActionsProvider actions={...}>. Components puxam mutations
// atraves de useAgendaActions() — cada app injeta suas server actions
// (requireRole no crm, requireSuperadminForOrg no admin).
//
// Re-export central — apps fazem
//   import { useAppointments, AgendaOverview } from "@persia/agenda-ui";

export type {
  AgendaActions,
  AgendaCallbacks,
  LeadOption,
  AgendaUserOption,
} from "./actions";
export {
  AgendaActionsProvider,
  useAgendaActions,
  useAgendaCallbacks,
  type AgendaActionsProviderProps,
} from "./context";

// Hooks
export {
  useAppointments,
  useAppointmentsRealtime,
  type AppointmentRealtimeEvent,
  useAgendaServices,
  useAvailability,
  useBookingPages,
  useAgendaFilters,
  type AgendaViewMode,
} from "./hooks";

// Components — PR3 batch 1 (essenciais leitura)
export { AppointmentStatusBadge } from "./components/AppointmentStatusBadge";
export { AppointmentCard } from "./components/AppointmentCard";
export { TodayAppointments } from "./components/TodayAppointments";
export { AgendaHeader } from "./components/AgendaHeader";
export { AgendaOverview } from "./components/AgendaOverview";

// Components — PR4 batch 2 (calendar views + tabs + drawer read-only)
// PR8a: AgendaWeekView + AgendaMonthView removidos. Calendar agora usa
// react-big-calendar (Day/Week/Month/Agenda built-in, drag, current time
// line, color por status, etc). AgendaListView mantido pra fallback.
export { AgendaTabs, type AgendaTab } from "./components/AgendaTabs";
export { AgendaListView } from "./components/AgendaListView";
export { AgendaCalendarView } from "./components/AgendaCalendarView";
export { AppointmentDrawer } from "./components/AppointmentDrawer";

// Components — PR5a batch 3 (write: criar / reagendar)
export { LeadSearchSelect } from "./components/LeadSearchSelect";
export {
  AppointmentForm,
  type AppointmentFormHandle,
  type AppointmentFormValues,
} from "./components/AppointmentForm";
export { CreateAppointmentDrawer } from "./components/CreateAppointmentDrawer";
export { RescheduleAppointmentDrawer } from "./components/RescheduleAppointmentDrawer";
export { AgendaCreateMenu } from "./components/AgendaCreateMenu";

// Components — PR5b batch 4 (admin: disponibilidade + paginas)
export { TimeRangeInput } from "./components/TimeRangeInput";
export { AvailabilityDayRow } from "./components/AvailabilityDayRow";
export { WeeklyAvailabilityEditor } from "./components/WeeklyAvailabilityEditor";
export { AgendaAvailabilitySettings } from "./components/AgendaAvailabilitySettings";
export { BookingPageStatusBadge } from "./components/BookingPageStatusBadge";
export { BookingPageCard } from "./components/BookingPageCard";
export { BookingPageDrawer } from "./components/BookingPageDrawer";
export { AgendaBookingPagesList } from "./components/AgendaBookingPagesList";

// Components — PR7 batch 5 (settings: lembretes WhatsApp)
export {
  ReminderConfigDrawer,
  type ExistingPayload as ReminderConfigPayload,
} from "./components/ReminderConfigDrawer";
export {
  AgendaSettingsTab,
  type AgendaSettingsActions,
} from "./components/AgendaSettingsTab";
