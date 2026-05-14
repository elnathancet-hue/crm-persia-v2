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
  updateStageOrder,
} from "@/actions/pipelines";
import type { Pipeline, Stage } from "@persia/shared/crm";

export const adminKanbanActions: KanbanActions = {
  // ============ PIPELINES ============
  createPipeline: async (name) => {
    const result = await createPipeline(name);
    if (!result) throw new Error("Erro ao criar funil");
    return result as Pipeline;
  },
  // Sprint 3e: actions retornam ActionResult — repasse direto.
  updatePipelineName: (pipelineId, name) =>
    updatePipelineName(pipelineId, name),
  deletePipeline: (pipelineId) => deletePipeline(pipelineId),

  // ============ STAGES ============
  // Sprint 3e: createStage retorna ActionResult<Stage>; se outcome difere,
  // dispara updateStage subsequente. Repassa erro se algum dos 2 falhar.
  createStage: async ({ pipelineId, name, sortOrder, outcome }) => {
    const result = await createStage(pipelineId, name, sortOrder);
    if (result && "error" in result && result.error) return result;
    const stage = result && "data" in result ? result.data : undefined;
    if (!stage) return { error: "Erro ao criar etapa." };
    if (outcome && outcome !== "em_andamento") {
      const upd = await updateStage(stage.id, { outcome });
      if (upd && "error" in upd && upd.error) return { error: upd.error };
      return { data: { ...stage, outcome } as Stage };
    }
    return { data: stage as Stage };
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
  // PR-CRMCFG: reorder em batch. Sprint 3e: ActionResult — repasse.
  reorderStages: (stages) =>
    updateStageOrder(stages.map((s) => ({ id: s.id, position: s.position }))),

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
