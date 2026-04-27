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
} from "./types";

// Queries read-only compartilhadas entre apps/crm e apps/admin.
// Cada app passa { db, orgId } depois de fazer auth com seu padrao
// (requireRole vs requireSuperadminForOrg).
export type {
  CrmQueryContext,
  CrmQueryDb,
  PaginatedLeads,
  ListTagsOptions,
} from "./queries";

export type {
  ListPipelinesOptions,
  ListDealsOptions,
} from "./queries";

export {
  listLeads,
  fetchLead,
  fetchLeadActivities,
  listTags,
  listTagsWithCount,
  listPipelines,
  listStages,
  listDeals,
} from "./queries";

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
} from "./mutations";
