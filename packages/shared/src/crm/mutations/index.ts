// Mutations CRM compartilhadas entre apps/crm e apps/admin.
//
// Cada app passa um CrmMutationContext ({ db, orgId, onLeadChanged? })
// depois de fazer auth com seu padrao. CRM injeta um callback que
// dispara syncLeadToUazapi; admin omite.
//
// Throw em qualquer erro. Wrappers nos apps adaptam pro shape de
// retorno historico de cada um (CRM: throw direto, admin: { data, error }).

export type { CrmMutationContext } from "./context";

export type {
  CreateLeadInput,
  UpdateLeadInput,
  CreatedLead,
} from "./leads";
export { createLead, updateLead, deleteLead } from "./leads";

export type { CreateTagInput, UpdateTagInput } from "./tags";
export {
  createTag,
  updateTag,
  deleteTag,
  addTagToLead,
  removeTagFromLead,
} from "./tags";

export type {
  CreatePipelineOptions,
  CreateStageInput,
  UpdateStageInput,
} from "./pipelines";
export {
  createPipeline,
  ensureDefaultPipeline,
  updatePipelineName,
  deletePipeline,
  createStage,
  updateStage,
  updateStageOrder,
  deleteStage,
} from "./pipelines";

export type {
  CreateDealInput,
  UpdateDealInput,
  DealStatus,
} from "./deals";
export {
  createDeal,
  updateDeal,
  updateDealStatus,
  moveDealKanban,
  deleteDeal,
  bulkMoveDealsToStage,
  bulkUpdateDealStatus,
  bulkDeleteDeals,
  bulkApplyTagsToDealLeads,
} from "./deals";
