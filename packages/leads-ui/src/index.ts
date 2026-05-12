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
export { DataTable, type ColumnDef } from "./components/DataTable";
export {
  LeadCommentsTab,
  type LeadCommentsTabProps,
  type LeadCommentsTabMember,
} from "./components/LeadCommentsTab";
