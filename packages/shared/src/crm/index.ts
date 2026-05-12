// Public surface of @persia/shared/crm
//
// Tipos canônicos do domínio CRM (leads, deals, pipelines, stages, tags,
// segments). Consumidos por apps/crm e apps/admin via:
//
//   import type { LeadWithTags, Pipeline } from "@persia/shared/crm";
//
// Ver `types.ts` pra detalhes de cada tipo.

export type {
  // Lead
  LeadFilters,
  LeadWithTags,
  LeadCustomFieldValue,
  LeadDetail,
  LeadActivity,
  // Tag
  TagRef,
  Tag,
  TagWithCount,
  LeadTagJoin,
  // Pipeline + Stage + Deal
  Pipeline,
  Stage,
  StageOutcome,
  Deal,
  DealWithLead,
  StageWithDeals,
  PipelineWithStages,
  PipelineWithStagesAndDeals,
  PipelineGoal,
  // Segment
  SegmentCondition,
  SegmentRules,
  Segment,
  // Deal loss tracking (PR-K3)
  DealLossReason,
} from "./types";

// Queries read-only compartilhadas entre apps/crm e apps/admin.
// Cada app passa { db, orgId } depois de fazer auth com seu padrao
// (requireRole vs requireSuperadminForOrg).
export type {
  CrmQueryContext,
  CrmQueryDb,
  PaginatedLeads,
  LeadForDealAssignment,
  ListTagsOptions,
  OrgActivityRow,
  OrgActivitiesResult,
  ListOrgActivitiesOptions,
} from "./queries";

export type {
  ListPipelinesOptions,
  ListDealsOptions,
  LeadOpenDealWithStages,
  // PR-S5: types do drawer
  LeadStats,
  LeadDealItem,
  LeadCustomFieldDef,
  LeadCustomFieldEntry,
} from "./queries";

export {
  listLeads,
  fetchLead,
  fetchLeadActivities,
  listLeadsForDealAssignment,
  listTags,
  listTagsWithCount,
  listPipelines,
  listStages,
  listStagesForOrg,
  getDefaultPipelineStage,
  listDeals,
  findLeadOpenDealWithStages,
  listLossReasons,
  listOrgActivities,
  // PR-S5: queries do drawer
  fetchLeadStats,
  fetchLeadDealsList,
  fetchLeadCustomFields,
  upsertLeadCustomFieldValue,
} from "./queries";

// PR-CRMOPS3: helper que resolve regras de segmento em IDs de leads.
// Usado pelo listLeads pra aplicar filtro de segmento (segmentId ->
// pre-fetcha matching leads -> aplica .in('id', leadIds) na query).
export { findMatchingLeadIds } from "./segments/match-leads";

// Mutations CRM compartilhadas (CRUD de leads + tags + pipelines + deals).
// Cada app passa { db, orgId, onLeadChanged? } depois de fazer auth.
export type {
  CrmMutationContext,
  CreateLeadInput,
  UpdateLeadInput,
  CreatedLead,
  CreateTagInput,
  UpdateTagInput,
  CreatePipelineOptions,
  CreateStageInput,
  UpdateStageInput,
  CreateDealInput,
  UpdateDealInput,
  DealStatus,
  MarkDealAsLostInput,
  CreateLossReasonInput,
  UpdateLossReasonInput,
} from "./mutations";

export {
  createLead,
  updateLead,
  deleteLead,
  createTag,
  updateTag,
  deleteTag,
  addTagToLead,
  removeTagFromLead,
  createPipeline,
  ensureDefaultPipeline,
  updatePipelineName,
  deletePipeline,
  createStage,
  updateStage,
  updateStageOrder,
  deleteStage,
  createDeal,
  updateDeal,
  updateDealStatus,
  moveDealKanban,
  deleteDeal,
  bulkMoveDealsToStage,
  bulkUpdateDealStatus,
  bulkDeleteDeals,
  bulkApplyTagsToDealLeads,
  markDealAsLost,
  bulkMarkDealsAsLost,
  createLossReason,
  updateLossReason,
  deleteLossReason,
  sanitizeMutationError,
  // PR-S5: find-or-create conversa por lead
  findOrCreateConversationByLead,
} from "./mutations";

// PR-S5: type tambem exportado pro caller wrappear retorno
export type { FindOrCreateConversationResult } from "./mutations";
