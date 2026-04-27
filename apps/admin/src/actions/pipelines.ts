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
  listPipelines,
  moveDealKanban,
  updateDealStatus as updateDealStatusShared,
  updateStage as updateStageShared,
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
  data: { name?: string; color?: string; sort_order?: number },
) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updateStageShared({ db: admin, orgId }, stageId, {
      name: data.name,
      color: data.color,
      sortOrder: data.sort_order,
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

export async function deletePipeline(pipelineId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await deletePipelineShared({ db: admin, orgId }, pipelineId);
    revalidatePath("/crm");
  } catch {
    // noop
  }
}
