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
  createPipeline,
  createStage,
  deleteDeal,
  deletePipeline,
  deleteStage,
  getLossReasons,
  markDealAsLost,
  updateDeal,
  updateDealStage,
  updatePipelineName,
  updateStage,
} from "@/actions/crm";

export const crmKanbanActions: KanbanActions = {
  // ============ PIPELINES ============
  createPipeline: async (name) => {
    const fd = new FormData();
    fd.set("name", name);
    return createPipeline(fd);
  },
  updatePipelineName: (pipelineId, name) =>
    updatePipelineName(pipelineId, name),
  deletePipeline: (pipelineId) => deletePipeline(pipelineId),

  // ============ STAGES ============
  createStage: async ({ pipelineId, name, sortOrder, outcome }) => {
    const fd = new FormData();
    fd.set("pipeline_id", pipelineId);
    fd.set("name", name);
    fd.set("sort_order", String(sortOrder));
    const stage = await createStage(fd);
    // O wrapper de createStage nao aceita outcome direto; se o caller
    // pediu outro bucket, atualiza logo apos. Mantem compatibilidade
    // com o comportamento original do PipelineConfigDrawer.
    if (stage && outcome && outcome !== "em_andamento") {
      await updateStage(stage.id, { outcome });
      return { ...stage, outcome };
    }
    return stage;
  },
  updateStage: (stageId, data) =>
    updateStage(stageId, {
      name: data.name,
      outcome: data.outcome,
    }),
  deleteStage: (stageId) => deleteStage(stageId),

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
  updateDeal: (dealId, data) =>
    updateDeal(dealId, { title: data.title, value: data.value }),
  // Rich move — dispara activity log + onStageChanged + sync UAZAPI.
  moveDealStage: (dealId, stageId) => updateDealStage(dealId, stageId),
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
};
