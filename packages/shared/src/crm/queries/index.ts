// Queries CRM compartilhadas — read-only.
//
// Cada app (crm/admin) faz auth com seu padrao (requireRole vs
// requireSuperadminForOrg) e passa { db, orgId } pra estas funcoes.
// A logica de filtragem, paginacao, joins e org-scoping fica aqui,
// uma unica vez.

export type { CrmQueryContext, CrmQueryDb } from "./context";
export type {
  PaginatedLeads,
  LeadForDealAssignment,
  OrgActivityRow,
  OrgActivitiesResult,
  ListOrgActivitiesOptions,
} from "./leads";
export type { ListTagsOptions } from "./tags";
export type { ListPipelinesOptions } from "./pipelines";
export type { ListDealsOptions, LeadOpenDealWithStages } from "./deals";

export {
  listLeads,
  fetchLead,
  fetchLeadActivities,
  listLeadsForDealAssignment,
  listOrgActivities,
} from "./leads";

export { listTags, listTagsWithCount } from "./tags";

export {
  listPipelines,
  listStages,
  listStagesForOrg,
  getDefaultPipelineStage,
} from "./pipelines";

export { listDeals, findLeadOpenDealWithStages } from "./deals";

// PR-K-CENTRIC (mai/2026): queries lead-centric do Kanban.
// listDeals/findLeadOpenDealWithStages permanecem pra historico/compat
// mas o board agora usa listLeadsKanban.
export type { ListLeadsKanbanOptions, LeadStageContext } from "./leads-kanban";
export { listLeadsKanban, findLeadStageContext } from "./leads-kanban";

export { listLossReasons } from "./loss-reasons";

// PR-S5: queries do drawer "Informacoes do lead" extraidas dos apps.
export type { LeadStats, LeadDealItem } from "./lead-stats";
export { fetchLeadStats, fetchLeadDealsList } from "./lead-stats";
export type {
  LeadCustomFieldDef,
  LeadCustomFieldEntry,
} from "./custom-fields";
export {
  fetchLeadCustomFields,
  upsertLeadCustomFieldValue,
} from "./custom-fields";

// PR-AGENDA-LAST-MSG (mai/2026): query da ultima mensagem do lead.
// Usado pelo AppointmentDrawer pra mostrar contexto inline.
export type {
  LeadLastMessagePreview,
  LeadMessageDirection,
} from "./messages";
export { findLastMessageForLead, deriveDirection } from "./messages";
