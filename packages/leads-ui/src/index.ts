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
} from "./actions";
export {
  LeadsProvider,
  useLeadsActions,
  type LeadsProviderProps,
} from "./context";

export { LeadsList, type LeadsListProps } from "./components/LeadsList";
export { LeadForm } from "./components/LeadForm";
export { DataTable, type ColumnDef } from "./components/DataTable";
export {
  LeadCommentsTab,
  type LeadCommentsTabProps,
  type LeadCommentsTabMember,
} from "./components/LeadCommentsTab";

// PR-S2: realtime hooks compartilhados. Cada hook recebe supabase
// como param — caller (app) injeta seu proprio client. Hooks puros
// (debounce/toast-prefs) nao tem dependencia de supabase.
export { useDebouncedCallback } from "./hooks/use-debounced-callback";
export {
  useToastMuted,
  useIsToastMuted,
} from "./hooks/use-toast-prefs";
export {
  useCurrentUser,
  type CurrentUser,
} from "./hooks/use-current-user";
export {
  useLeadsRealtime,
  type LeadRealtimeEvent,
} from "./hooks/use-leads-realtime";
export {
  useDealsRealtime,
  type DealRealtimeEvent,
} from "./hooks/use-deals-realtime";
export {
  useLeadPresence,
  type PresenceUser,
  type LeadCommentRealtimeEvent,
  type UseLeadPresenceOptions,
  type UseLeadPresenceResult,
} from "./hooks/use-lead-presence";
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
