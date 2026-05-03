// Queries CRM compartilhadas — read-only.
//
// Cada app (crm/admin) faz auth com seu padrao (requireRole vs
// requireSuperadminForOrg) e passa { db, orgId } pra estas funcoes.
// A logica de filtragem, paginacao, joins e org-scoping fica aqui,
// uma unica vez.

export type { CrmQueryContext, CrmQueryDb } from "./context";
export type { PaginatedLeads, LeadForDealAssignment } from "./leads";
export type { ListTagsOptions } from "./tags";
export type { ListPipelinesOptions } from "./pipelines";
export type { ListDealsOptions, LeadOpenDealWithStages } from "./deals";

export {
  listLeads,
  fetchLead,
  fetchLeadActivities,
  listLeadsForDealAssignment,
} from "./leads";

export { listTags, listTagsWithCount } from "./tags";

export { listPipelines, listStages, listStagesForOrg } from "./pipelines";

export { listDeals, findLeadOpenDealWithStages } from "./deals";

export { listLossReasons } from "./loss-reasons";
