// @persia/agenda-ui — shared Agenda UI surface.
//
// Apps (crm, admin) consomem estes componentes via
// <AgendaActionsProvider actions={...}>. Components puxam mutations
// atraves de useAgendaActions() — cada app injeta suas server actions
// (requireRole no crm, requireSuperadminForOrg no admin).
//
// Re-export central — apps fazem
//   import { useAppointments, AgendaOverview } from "@persia/agenda-ui";

export type { AgendaActions, AgendaCallbacks } from "./actions";
export {
  AgendaActionsProvider,
  useAgendaActions,
  useAgendaCallbacks,
  type AgendaActionsProviderProps,
} from "./context";

// Hooks
export {
  useAppointments,
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
export { AgendaTabs, type AgendaTab } from "./components/AgendaTabs";
export { AgendaListView } from "./components/AgendaListView";
export { AgendaWeekView } from "./components/AgendaWeekView";
export { AgendaMonthView } from "./components/AgendaMonthView";
export { AgendaCalendarView } from "./components/AgendaCalendarView";
export { AppointmentDrawer } from "./components/AppointmentDrawer";
