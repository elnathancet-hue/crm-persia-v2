// Mutations CRM compartilhadas entre apps/crm e apps/admin.
//
// Cada app passa um CrmMutationContext ({ db, orgId, onLeadChanged? })
// depois de fazer auth com seu padrao. CRM injeta um callback que
// dispara syncLeadToUazapi; admin omite.
//
// Throw em qualquer erro. Wrappers nos apps adaptam pro shape de
// retorno historico de cada um (CRM: throw direto, admin: { data, error }).

export type { CrmMutationContext } from "./context";
export { sanitizeMutationError } from "./errors";

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
  MarkDealAsLostInput,
  CreateLossReasonInput,
  UpdateLossReasonInput,
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
  markDealAsLost,
  bulkMarkDealsAsLost,
  createLossReason,
  updateLossReason,
  deleteLossReason,
} from "./deals";

// PR-S5: find-or-create de conversa WhatsApp por lead (botao "Abrir
// conversa" no menu de 3 pontos do LeadsList).
export type { FindOrCreateConversationResult } from "./conversations";
export { findOrCreateConversationByLead } from "./conversations";

// PR-K-CENTRIC (mai/2026): mutations lead-centric do Kanban.
// Substituem moveDealKanban/bulkMoveDealsToStage/bulkMarkDealsAsLost
// quando o caller indexar por lead. Deals continuam disponiveis pra
// gestao da subentidade dentro do drawer.
export type { MarkLeadAsLostInput } from "./leads-kanban";
export {
  moveLeadToStage,
  moveLeadToPipeline,
  bulkMoveLeads,
  bulkMarkLeadsAsLost,
  bulkMarkLeadsAsWon,
} from "./leads-kanban";
