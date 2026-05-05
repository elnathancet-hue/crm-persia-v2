"use server";

import { requireSuperadminForOrg } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  createDeal as createDealShared,
  createPipeline as createPipelineShared,
  createStage as createStageShared,
  deleteDeal as deleteDealShared,
  deletePipeline as deletePipelineShared,
  deleteStage as deleteStageShared,
  ensureDefaultPipeline as ensureDefaultPipelineShared,
  listDeals as listDealsShared,
  listLeadsForDealAssignment,
  listPipelines,
  listStages as listStagesShared,
  listStagesForOrg,
  moveDealKanban,
  updateDeal as updateDealShared,
  updateDealStatus as updateDealStatusShared,
  updatePipelineName as updatePipelineNameShared,
  updateStage as updateStageShared,
  updateStageOrder as updateStageOrderShared,
} from "@persia/shared/crm";

// Logica de pipelines/stages/deals consolidada em @persia/shared/crm.
// Aqui apenas resolvemos auth (requireSuperadminForOrg), adaptamos o
// shape historico do admin (`null` em validation failure, `{ error }`
// em delete) com try/catch fino, e disparamos revalidatePath.

export async function getPipelines() {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    return await listPipelines(
      { db: admin, orgId },
      { withStagesAndDeals: true },
    );
  } catch {
    return [];
  }
}

export async function createPipeline(name: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const pipeline = await createPipelineShared({ db: admin, orgId }, { name });
    revalidatePath("/crm");
    return pipeline;
  } catch {
    return null;
  }
}

export async function createDeal(data: {
  pipeline_id: string;
  stage_id: string;
  title: string;
  value: number;
  lead_id?: string;
}) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const deal = await createDealShared(
      { db: admin, orgId },
      {
        pipelineId: data.pipeline_id,
        stageId: data.stage_id,
        title: data.title,
        value: data.value,
        leadId: data.lead_id,
      },
    );
    revalidatePath("/crm");
    return deal;
  } catch {
    return null;
  }
}

export async function moveDeal(
  dealId: string,
  stageId: string,
  sortOrder: number,
) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await moveDealKanban({ db: admin, orgId }, dealId, stageId, sortOrder);
    revalidatePath("/crm");
  } catch {
    // Comportamento historico: noop em validation failure.
  }
}

export async function deleteDeal(dealId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await deleteDealShared({ db: admin, orgId }, dealId);
    revalidatePath("/crm");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro desconhecido" };
  }
}

export async function createStage(
  pipelineId: string,
  name: string,
  sortOrder: number,
  color?: string,
) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const stage = await createStageShared(
      { db: admin, orgId },
      { pipelineId, name, sortOrder, color },
    );
    revalidatePath("/crm");
    return stage;
  } catch {
    return null;
  }
}

export async function updateDealStatus(
  dealId: string,
  status: "open" | "won" | "lost",
) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updateDealStatusShared({ db: admin, orgId }, dealId, status);
    revalidatePath("/crm");
  } catch {
    // noop
  }
}

export async function updateStage(
  stageId: string,
  data: {
    name?: string;
    color?: string;
    sort_order?: number;
    description?: string | null;
    outcome?: "em_andamento" | "falha" | "bem_sucedido";
  },
) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updateStageShared({ db: admin, orgId }, stageId, {
      name: data.name,
      color: data.color,
      sortOrder: data.sort_order,
      description: data.description,
      outcome: data.outcome,
    });
    revalidatePath("/crm");
  } catch {
    // noop
  }
}

export async function deleteStage(stageId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await deleteStageShared({ db: admin, orgId }, stageId);
    revalidatePath("/crm");
  } catch {
    // noop
  }
}

/**
 * PR-CRMCFG: reorder em batch — usado pelo PipelineSettingsClient
 * (editor de configuracao em /crm/configurar). Reusa o shared mutation
 * (`updateStageOrder`) que ja serializa updates e e org-scoped via
 * defense-in-depth.
 */
export async function updateStageOrder(
  stages: { id: string; position: number }[],
) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updateStageOrderShared({ db: admin, orgId }, stages);
    revalidatePath("/crm");
  } catch {
    // noop
  }
}

export async function deletePipeline(pipelineId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await deletePipelineShared({ db: admin, orgId }, pipelineId);
    revalidatePath("/crm");
  } catch {
    // noop
  }
}

export async function updatePipelineName(pipelineId: string, name: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updatePipelineNameShared({ db: admin, orgId }, pipelineId, name);
    revalidatePath("/crm");
  } catch {
    // noop
  }
}

export async function updateDeal(
  dealId: string,
  data: {
    title?: string;
    value?: number;
    status?: string;
    lead_id?: string | null;
  },
) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updateDealShared({ db: admin, orgId }, dealId, {
      title: data.title,
      value: data.value,
      status: data.status,
      leadId: data.lead_id,
    });
    revalidatePath("/crm");
  } catch {
    // noop
  }
}

/** Move "leve" — atualiza stage_id sem disparar flows/sync (admin
 * superadmin nao precisa de side-effects por padrao). Caller pode
 * preferir esse behavior em vez do `moveDeal` (que e drag-drop com
 * sort_order). */
export async function moveDealStage(dealId: string, stageId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await moveDealKanban({ db: admin, orgId }, dealId, stageId, 0);
    revalidatePath("/crm");
  } catch {
    // noop
  }
}

export async function getStagesForOrg() {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    return await listStagesForOrg({ db: admin, orgId });
  } catch {
    return [];
  }
}

export async function getStagesForPipeline(pipelineId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    return await listStagesShared({ db: admin, orgId }, pipelineId);
  } catch {
    return [];
  }
}

export async function getDeals(pipelineId?: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    return await listDealsShared({ db: admin, orgId }, { pipelineId });
  } catch {
    return [];
  }
}

export async function getLeads() {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    return await listLeadsForDealAssignment({ db: admin, orgId });
  } catch {
    return [];
  }
}

export async function ensureDefaultPipeline() {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const id = await ensureDefaultPipelineShared({ db: admin, orgId });
    revalidatePath("/crm");
    return id;
  } catch {
    return null;
  }
}
