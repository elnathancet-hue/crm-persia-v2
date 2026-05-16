// @persia/leads-ui — shared Leads UI surface.
//
// Both @persia/crm and @persia/admin consume these components via
// <LeadsProvider actions={...}>. Components pull mutations through
// useLeadsActions() so each app can wire its own server actions
// (requireRole on crm, requireSuperadminForOrg on admin).

export type {
  LeadsActions,
  PaginatedLeadsResult,
  OrgTag,
  LeadComment,
  DuplicateMatch,
  LeadStats,
  LeadDealItem,
  DrawerStageRef,
  LeadOpenDealWithStages,
  LeadCustomFieldDef,
  LeadCustomFieldEntry,
  LeadAgentHandoffState,
} from "./actions";
export {
  LeadsProvider,
  useLeadsActions,
  type LeadsProviderProps,
} from "./context";

export { LeadsList, type LeadsListProps } from "./components/LeadsList";
export { LeadForm } from "./components/LeadForm";
export {
  LeadsAdvancedFilters,
  type LeadsAdvancedFiltersValue,
  type LeadsAdvancedFiltersProps,
} from "./components/LeadsAdvancedFilters";
export {
  ExportLeadsDialog,
  type ExportLeadsDialogProps,
} from "./components/ExportLeadsDialog";
export { DataTable, type ColumnDef } from "./components/DataTable";
export {
  LeadCommentsTab,
  type LeadCommentsTabProps,
  type LeadCommentsTabMember,
} from "./components/LeadCommentsTab";

// PR-U2: drawer "Informações do lead" extraído do CRM. Consome
// actions via useLeadsActions() (DI). CRM e admin passam supabase
// como prop (DI tambem).
export { LeadInfoDrawer } from "./components/LeadInfoDrawer";

// PR-U2: hooks de realtime usados pelo drawer (subsumindo parte do
// PR-S2). Recebem supabase como param.
export {
  useCurrentUser,
  type CurrentUser,
} from "./hooks/use-current-user";
export {
  useLeadPresence,
  type PresenceUser,
  type LeadCommentRealtimeEvent,
  type UseLeadPresenceOptions,
  type UseLeadPresenceResult,
} from "./hooks/use-lead-presence";

// PR-V1a: 7 hooks de realtime restantes movidos de apps/crm/src/lib/realtime
// (completa o S2). Todos com supabase via DI pra funcionar em CRM (anon)
// e admin (anon + cookie superadmin). use-current-org-id NAO foi movido —
// e app-specific (CRM resolve via organization_members + JWT; admin usa
// Zustand store).
export { useDebouncedCallback } from "./hooks/use-debounced-refresh";
export {
  useToastMuted,
  useIsToastMuted,
} from "./hooks/use-toast-prefs";
export {
  useLeadsRealtime,
  type LeadRealtimeEvent,
} from "./hooks/use-leads-realtime";
// PR-K-CENTRIC realtime fix (mai/2026): hook especifico do Kanban —
// filtra leads por pipeline_id. Necessario porque drag-drop/AI/n8n
// atualizam leads.stage_id mas useDealsRealtime so escuta deals.
export {
  useKanbanLeadsRealtime,
  type KanbanLeadRealtimeEvent,
} from "./hooks/use-kanban-leads-realtime";
export {
  useDealsRealtime,
  type DealRealtimeEvent,
} from "./hooks/use-deals-realtime";
export {
  useDealPresence,
  type DealPresenceUser,
  type UseDealPresenceOptions,
  type UseDealPresenceResult,
} from "./hooks/use-deal-presence";
export {
  useCommentToast,
  type UseCommentToastOptions,
} from "./hooks/use-comment-toast";
export {
  useAssignmentToast,
  type UseAssignmentToastOptions,
} from "./hooks/use-assignment-toast";
