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
