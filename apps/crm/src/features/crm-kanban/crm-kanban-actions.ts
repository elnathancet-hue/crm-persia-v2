// CRM-side KanbanActions wiring.
//
// Server actions ja resolvem orgId via cookie da sessao (requireRole). O
// wrapper so mapeia 1-pra-1 no formato esperado pelo @persia/crm-ui.
// O admin faz o equivalente em apps/admin com requireSuperadminForOrg.

import type { KanbanActions } from "@persia/crm-ui";
import {
  bulkApplyTagsToDeals,
  bulkMarkDealsAsLost,
  bulkMoveDeals,
  bulkRemoveDeals,
  bulkSetDealStatus,
  createDeal,
  createLeadWithDeal,
  createPipeline,
  createStage,
  deleteDeal,
  deletePipeline,
  deleteStage,
  getLossReasons,
  markDealAsLost,
  updateDeal,
  updatePipelineName,
  updateStage,
  updateStageOrder,
} from "@/actions/crm";
import {
  addTagToLead,
  assignLead,
  removeTagFromLead,
} from "@/actions/leads";
import {
  bulkMarkLeadsAsLost,
  bulkMarkLeadsAsWon,
  bulkMoveLeads,
  createLeadInPipeline,
  moveLeadStage,
  moveLeadToPipeline,
} from "@/actions/leads-kanban";
import { findOrCreateConversationByLead } from "@/actions/conversations";

export const crmKanbanActions: KanbanActions = {
  // ============ LEAD-CENTRIC (PR-K-CENTRIC mai/2026) ============
  createLeadInPipeline: (input) => createLeadInPipeline(input),
  moveLeadStage: (leadId, stageId, sortOrder) =>
    moveLeadStage(leadId, stageId, sortOrder),
  moveLeadToPipeline: (leadId, pipelineId, stageId) =>
    moveLeadToPipeline(leadId, pipelineId, stageId),
  bulkMoveLeads: (leadIds, stageId) => bulkMoveLeads(leadIds, stageId),
  bulkMarkLeadsAsWon: (leadIds) => bulkMarkLeadsAsWon(leadIds),
  bulkMarkLeadsAsLost: (leadIds, input) =>
    bulkMarkLeadsAsLost(leadIds, input),
  // bulkDeleteLeadsFromKanban + bulkApplyTagsToLeads: TODO (precisam shared)

  // ============ PIPELINES ============
  createPipeline: async (name) => {
    const fd = new FormData();
    fd.set("name", name);
    return createPipeline(fd);
  },
  // Sprint 3e: actions retornam ActionResult — repasse direto.
  updatePipelineName: (pipelineId, name) =>
    updatePipelineName(pipelineId, name),
  deletePipeline: (pipelineId) => deletePipeline(pipelineId),

  // ============ STAGES ============
  // Sprint 3e: createStage aceita objeto + ActionResult (sem FormData).
  // Se caller pediu outro bucket que nao em_andamento, faz update apos.
  createStage: async ({ pipelineId, name, sortOrder, outcome }) => {
    const result = await createStage({ pipelineId, name, sortOrder });
    if (result && "error" in result && result.error) return result;
    const stage = result && "data" in result ? result.data : undefined;
    if (stage && outcome && outcome !== "em_andamento") {
      const upd = await updateStage(stage.id, { outcome });
      if (upd && "error" in upd && upd.error) return { error: upd.error };
      return { data: { ...stage, outcome } };
    }
    return result;
  },
  // PR-CRMCFG: passa todos os campos do UpdateStageInput.
  // Sprint 3e: ActionResult — repasse.
  updateStage: (stageId, data) =>
    updateStage(stageId, {
      name: data.name,
      color: data.color,
      description: data.description,
      sort_order: data.sortOrder,
      outcome: data.outcome,
    }),
  deleteStage: (stageId) => deleteStage(stageId),
  // PR-CRMCFG: reorder em batch (drag-drop ou setas no editor de
  // configuracao). Sprint 3e: ActionResult — repasse.
  reorderStages: (stages) =>
    updateStageOrder(stages.map((s) => ({ id: s.id, position: s.position }))),

  // ============ DEALS ============
  createDeal: async ({ pipelineId, stageId, title, value, leadId }) => {
    const fd = new FormData();
    fd.set("pipeline_id", pipelineId);
    fd.set("stage_id", stageId);
    fd.set("title", title);
    fd.set("value", String(value));
    if (leadId) fd.set("lead_id", leadId);
    return createDeal(fd);
  },
  // PR-CRMOPS2: novo fluxo do "+" da coluna do Kanban — cria lead +
  // deal numa unica acao. Reusa server action createLeadWithDeal que
  // por sua vez chama createLead + createDeal do shared.
  createLeadWithDeal: ({ lead, pipelineId, stageId, dealTitle, dealValue }) =>
    createLeadWithDeal({ lead, pipelineId, stageId, dealTitle, dealValue }),
  updateDeal: (dealId, data) =>
    updateDeal(dealId, { title: data.title, value: data.value }),
  deleteDeal: (dealId) => deleteDeal(dealId),

  // ============ BULK (PR-K2) ============
  // Cap de 200 itens / chamada (validado no shared). Bulk move usa
  // update plano (sem flow rico) — pra fluxo "ganhei/perdi" individual,
  // o caller deve usar moveDealStage que dispara activity log + sync.
  bulkMoveDeals: (dealIds, stageId) => bulkMoveDeals(dealIds, stageId),
  bulkSetDealStatus: (dealIds, status) => bulkSetDealStatus(dealIds, status),
  bulkDeleteDeals: (dealIds) => bulkRemoveDeals(dealIds),
  bulkApplyTagsToDeals: (dealIds, tagIds) =>
    bulkApplyTagsToDeals(dealIds, tagIds),

  // ============ LOSS TRACKING (PR-K3) ============
  getLossReasons: () => getLossReasons(),
  markDealAsLost: (dealId, input) => markDealAsLost(dealId, input),
  bulkMarkDealsAsLost: (dealIds, input) =>
    bulkMarkDealsAsLost(dealIds, input),

  // ============ CARD CONNECTIONS (PR-C) ============
  // Botao + Tag, dropdown Atribuir e "Abrir conversa" interna direto
  // do card. Reusa actions existentes (sem logica paralela).
  assignLead: async (leadId, userId) => {
    await assignLead(leadId, userId);
  },
  // Sprint 3d: actions retornam ActionResult; mantemos contrato void
  // do KanbanActions (migra na Sprint 3e).
  addTagToLead: async (leadId, tagId) => {
    await addTagToLead(leadId, tagId);
  },
  removeTagFromLead: async (leadId, tagId) => {
    await removeTagFromLead(leadId, tagId);
  },
  findOrCreateConversationByLead: (leadId) =>
    findOrCreateConversationByLead(leadId),
};
