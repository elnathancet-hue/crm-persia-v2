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
  listLeadsKanban as listLeadsKanbanShared,
  moveLeadToStage as moveLeadToStageShared,
  bulkMoveLeads as bulkMoveLeadsShared,
  bulkMarkLeadsAsLost as bulkMarkLeadsAsLostShared,
  bulkMarkLeadsAsWon as bulkMarkLeadsAsWonShared,
  createLead as createLeadShared,
  type MarkLeadAsLostInput,
  listLeadsForDealAssignment,
  listPipelines,
  listStages as listStagesShared,
  listStagesForOrg,
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

// Sprint 3e: migra pra ActionResult — antes retornava null em erro
// (silencioso, user nao via nada). Agora { error } com mensagem PT-BR.
export async function createStage(
  pipelineId: string,
  name: string,
  sortOrder: number,
  color?: string,
): Promise<import("@persia/ui").ActionResult<import("@persia/shared/crm").Stage>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const stage = await createStageShared(
      { db: admin, orgId },
      { pipelineId, name, sortOrder, color },
    );
    revalidatePath("/crm");
    return { data: stage };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível criar a etapa.",
    };
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

// Sprint 3e: migra pra ActionResult — antes era catch {} silencioso.
export async function updateStage(
  stageId: string,
  data: {
    name?: string;
    color?: string;
    sort_order?: number;
    description?: string | null;
    outcome?: "em_andamento" | "falha" | "bem_sucedido";
  },
): Promise<import("@persia/ui").ActionResult<void>> {
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
    return;
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível atualizar a etapa.",
    };
  }
}

export async function deleteStage(
  stageId: string,
): Promise<import("@persia/ui").ActionResult<void>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await deleteStageShared({ db: admin, orgId }, stageId);
    revalidatePath("/crm");
    return;
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível excluir a etapa.",
    };
  }
}

/**
 * PR-CRMCFG: reorder em batch — usado pelo PipelineSettingsClient
 * (editor de configuracao em /crm/configurar). Reusa o shared mutation
 * (`updateStageOrder`) que ja serializa updates e e org-scoped via
 * defense-in-depth.
 * Sprint 3e: migra pra ActionResult.
 */
export async function updateStageOrder(
  stages: { id: string; position: number }[],
): Promise<import("@persia/ui").ActionResult<void>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updateStageOrderShared({ db: admin, orgId }, stages);
    revalidatePath("/crm");
    return;
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível reordenar as etapas.",
    };
  }
}

export async function deletePipeline(
  pipelineId: string,
): Promise<import("@persia/ui").ActionResult<void>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await deletePipelineShared({ db: admin, orgId }, pipelineId);
    revalidatePath("/crm");
    return;
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível excluir o funil.",
    };
  }
}

export async function updatePipelineName(
  pipelineId: string,
  name: string,
): Promise<import("@persia/ui").ActionResult<void>> {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    await updatePipelineNameShared({ db: admin, orgId }, pipelineId, name);
    revalidatePath("/crm");
    return;
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível renomear o funil.",
    };
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

// PR-K-CENTRIC (mai/2026): getDeals removida — substituída por getKanbanLeads.

// PR-K-CENTRIC (mai/2026): query principal do Kanban admin retorna LEADS.
export async function getKanbanLeads(pipelineId?: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    return await listLeadsKanbanShared({ db: admin, orgId }, { pipelineId });
  } catch (err) {
    console.error("[admin] getKanbanLeads falhou:", err);
    return [];
  }
}

export async function createLeadInPipeline(input: {
  lead: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    source?: string;
    status?: string;
    channel?: string;
    expected_value?: number | null;
  };
  pipelineId: string;
  stageId: string;
}): Promise<{ lead: { id: string } }> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const created = await createLeadShared(
    { db: admin, orgId },
    {
      name: input.lead.name ?? null,
      phone: input.lead.phone ?? null,
      email: input.lead.email ?? null,
      source: input.lead.source ?? "manual",
      status: input.lead.status ?? "new",
      channel: input.lead.channel ?? "manual",
    },
  );
  const { error: updErr } = await admin
    .from("leads")
    .update({
      pipeline_id: input.pipelineId,
      stage_id: input.stageId,
      sort_order: 0,
      expected_value: input.lead.expected_value ?? null,
    })
    .eq("id", created.id)
    .eq("organization_id", orgId);
  if (updErr) {
    throw new Error(`Lead criado mas falhou ao vincular ao funil: ${updErr.message}`);
  }
  return { lead: { id: created.id } };
}

export async function moveLeadStage(
  leadId: string,
  stageId: string,
  sortOrder: number,
): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();
  await moveLeadToStageShared({ db: admin, orgId }, leadId, stageId, sortOrder);
}

export async function bulkMoveLeads(leadIds: string[], stageId: string) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const result = await bulkMoveLeadsShared(
      { db: admin, orgId },
      leadIds,
      stageId,
    );
    return { data: result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro inesperado" };
  }
}

export async function bulkMarkLeadsAsWon(leadIds: string[]) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const result = await bulkMarkLeadsAsWonShared(
      { db: admin, orgId },
      leadIds,
    );
    return { data: result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro inesperado" };
  }
}

export async function bulkMarkLeadsAsLost(
  leadIds: string[],
  input: MarkLeadAsLostInput,
) {
  try {
    const { admin, orgId } = await requireSuperadminForOrg();
    const result = await bulkMarkLeadsAsLostShared(
      { db: admin, orgId },
      leadIds,
      input,
    );
    return { data: result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro inesperado" };
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
