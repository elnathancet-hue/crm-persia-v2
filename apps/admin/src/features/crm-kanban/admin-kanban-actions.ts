// Admin-side KanbanActions wiring.
//
// requireSuperadminForOrg() le orgId do cookie assinado (admin context)
// e devolve o admin (service-role) client. Cada metodo aqui chama o
// server action correspondente em @/actions/pipelines.

import type { KanbanActions } from "@persia/crm-ui";
import {
  createDeal,
  createPipeline,
  createStage,
  deleteDeal,
  deletePipeline,
  deleteStage,
  moveDealStage,
  updateDeal,
  updatePipelineName,
  updateStage,
} from "@/actions/pipelines";
import type { Pipeline, Stage } from "@persia/shared/crm";

export const adminKanbanActions: KanbanActions = {
  // ============ PIPELINES ============
  createPipeline: async (name) => {
    const result = await createPipeline(name);
    if (!result) throw new Error("Erro ao criar funil");
    return result as Pipeline;
  },
  updatePipelineName: (pipelineId, name) =>
    updatePipelineName(pipelineId, name),
  deletePipeline: (pipelineId) => deletePipeline(pipelineId),

  // ============ STAGES ============
  createStage: async ({ pipelineId, name, sortOrder, outcome }) => {
    const stage = await createStage(pipelineId, name, sortOrder);
    if (!stage) throw new Error("Erro ao criar etapa");
    if (outcome && outcome !== "em_andamento") {
      await updateStage(stage.id, { outcome });
      return { ...stage, outcome } as Stage;
    }
    return stage as Stage;
  },
  updateStage: (stageId, data) =>
    updateStage(stageId, { name: data.name, outcome: data.outcome }),
  deleteStage: (stageId) => deleteStage(stageId),

  // ============ DEALS ============
  createDeal: async ({ pipelineId, stageId, title, value, leadId }) => {
    const deal = await createDeal({
      pipeline_id: pipelineId,
      stage_id: stageId,
      title,
      value,
      lead_id: leadId ?? undefined,
    });
    if (!deal) throw new Error("Erro ao criar negocio");
    return deal as Awaited<ReturnType<KanbanActions["createDeal"]>>;
  },
  updateDeal: (dealId, data) =>
    updateDeal(dealId, { title: data.title, value: data.value }),
  // Admin usa light move (sem onStageChanged/sync UAZAPI). Comportamento
  // historico — superadmin nao deve disparar flows do tenant.
  moveDealStage: (dealId, stageId) => moveDealStage(dealId, stageId),
  deleteDeal: async (dealId) => {
    const result = await deleteDeal(dealId);
    if (result?.error) throw new Error(result.error);
  },
};
