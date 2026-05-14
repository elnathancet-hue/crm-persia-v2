"use server";

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { revalidateLeadCaches } from "@/lib/cache/lead-revalidation";
import {
  bulkApplyTagsToDealLeads as bulkApplyTagsShared,
  bulkDeleteDeals as bulkDeleteDealsShared,
  bulkMarkDealsAsLost as bulkMarkDealsAsLostShared,
  bulkMoveDealsToStage as bulkMoveDealsToStageShared,
  bulkUpdateDealStatus as bulkUpdateDealStatusShared,
  createDeal as createDealShared,
  createLead as createLeadShared,
  createLossReason as createLossReasonShared,
  createPipeline as createPipelineShared,
  createStage as createStageShared,
  deleteDeal as deleteDealShared,
  deleteLossReason as deleteLossReasonShared,
  deletePipeline as deletePipelineShared,
  deleteStage as deleteStageShared,
  ensureDefaultPipeline as ensureDefaultPipelineShared,
  findLeadOpenDealWithStages,
  listDeals,
  listLeadsForDealAssignment,
  listLossReasons as listLossReasonsShared,
  listPipelines,
  listStages,
  markDealAsLost as markDealAsLostShared,
  moveDealKanban,
  updateDeal as updateDealShared,
  updateDealStatus as updateDealStatusShared,
  updateLossReason as updateLossReasonShared,
  updatePipelineName as updatePipelineNameShared,
  updateStage as updateStageShared,
  updateStageOrder as updateStageOrderShared,
  type CreateLeadInput,
  type CreateLossReasonInput,
  type MarkDealAsLostInput,
  type UpdateLossReasonInput,
} from "@persia/shared/crm";

// Logica de pipelines/stages/deals consolidada em @persia/shared/crm.
// Aqui apenas resolvemos auth (requireRole) e disparamos revalidatePath.

// ============ PIPELINES ============

export async function getPipelines() {
  const { supabase, orgId } = await requireRole("agent");
  return listPipelines({ db: supabase, orgId });
}

export async function createPipeline(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");
  const name = (formData.get("name") as string) || undefined;
  const pipeline = await createPipelineShared({ db: supabase, orgId }, { name });
  revalidatePath("/crm");
  return pipeline;
}

// ============ STAGES ============

export async function getStages(pipelineId: string) {
  const { supabase, orgId } = await requireRole("agent");
  return listStages({ db: supabase, orgId }, pipelineId);
}

export async function createStage(formData: FormData) {
  const { supabase, orgId } = await requireRole("admin");
  const stage = await createStageShared(
    { db: supabase, orgId },
    {
      pipelineId: formData.get("pipeline_id") as string,
      name: formData.get("name") as string,
      sortOrder: parseInt(formData.get("sort_order") as string, 10) || 0,
      color: (formData.get("color") as string) || undefined,
    },
  );
  revalidatePath("/crm");
  return stage;
}

export async function updateStageOrder(
  stages: { id: string; position: number }[],
) {
  const { supabase, orgId } = await requireRole("admin");
  await updateStageOrderShared({ db: supabase, orgId }, stages);
  revalidatePath("/crm");
}

export async function updateStage(
  stageId: string,
  data: {
    name?: string;
    color?: string;
    sort_order?: number;
    description?: string | null;
    /** Move a stage entre buckets (em_andamento/falha/bem_sucedido). */
    outcome?: "em_andamento" | "falha" | "bem_sucedido";
  },
) {
  const { supabase, orgId } = await requireRole("admin");
  await updateStageShared({ db: supabase, orgId }, stageId, {
    name: data.name,
    color: data.color,
    sortOrder: data.sort_order,
    description: data.description,
    outcome: data.outcome,
  });
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function deleteStage(stageId: string) {
  const { supabase, orgId } = await requireRole("admin");
  await deleteStageShared({ db: supabase, orgId }, stageId);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function updatePipelineName(pipelineId: string, name: string) {
  const { supabase, orgId } = await requireRole("admin");
  await updatePipelineNameShared({ db: supabase, orgId }, pipelineId, name);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

export async function deletePipeline(pipelineId: string) {
  const { supabase, orgId } = await requireRole("admin");
  await deletePipelineShared({ db: supabase, orgId }, pipelineId);
  revalidatePath("/crm");
  revalidatePath("/crm/settings");
}

// ============ DEALS ============

export async function getDeals(pipelineId?: string) {
  const { supabase, orgId } = await requireRole("agent");
  return listDeals({ db: supabase, orgId }, { pipelineId });
}

/**
 * Retorna o deal aberto mais recente do lead + as stages do pipeline
 * desse deal (pra UI do drawer "Informações do lead" — subheader
 * clicável que troca a etapa atual sem sair da pagina). Se o lead
 * nao tem nenhum deal aberto, retorna null.
 */
export async function getLeadOpenDealWithStages(leadId: string) {
  const { supabase, orgId } = await requireRole("agent");
  return findLeadOpenDealWithStages({ db: supabase, orgId }, leadId);
}

export async function createDeal(formData: FormData) {
  const { supabase, orgId } = await requireRole("agent");
  const leadIdRaw = formData.get("lead_id") as string;
  const deal = await createDealShared(
    { db: supabase, orgId },
    {
      pipelineId: formData.get("pipeline_id") as string,
      stageId: formData.get("stage_id") as string,
      leadId: leadIdRaw || null,
      title: formData.get("title") as string,
      value: parseFloat((formData.get("value") as string) || "0"),
    },
  );
  revalidatePath("/crm");
  return deal;
}

/**
 * PR-CRMOPS2: cria lead + deal vinculado de uma vez. Usado pelo "+" das
 * colunas do Kanban (briefing C: o "+" deve abrir form de Lead, nao de
 * Negocio; ao salvar o lead deve aparecer imediatamente naquela coluna).
 *
 * Reusa createLeadShared + createDealShared do @persia/shared/crm. Zero
 * logica nova de DB. Se voce esta lendo isto pra criar uma terceira
 * forma de criar deal — pare e use esta. Caso falhe a criacao do deal
 * apos o lead ja ter sido criado, o erro vaza pro caller mas o lead
 * fica. Idempotency parcial: createLead ja faz upsert por phone.
 */
export interface CreateLeadWithDealInput {
  /** Campos do lead — mesmos que CreateLeadInput. */
  lead: CreateLeadInput;
  /** Onde criar o deal vinculado. */
  pipelineId: string;
  stageId: string;
  /** Titulo do deal. Default: nome do lead. */
  dealTitle?: string;
  /** Valor inicial do deal (R$). Default 0. */
  dealValue?: number;
}

export async function createLeadWithDeal(input: CreateLeadWithDealInput) {
  const { supabase, orgId } = await requireRole("agent");
  const ctx = { db: supabase, orgId };

  // 1. Cria (ou atualiza) o lead — createLead ja faz upsert por phone.
  const lead = await createLeadShared(ctx, input.lead);

  // 2. Cria o deal vinculado ao lead na etapa escolhida.
  const dealTitle = (input.dealTitle ?? input.lead.name ?? "Novo lead").trim();
  const deal = await createDealShared(ctx, {
    pipelineId: input.pipelineId,
    stageId: input.stageId,
    leadId: lead.id,
    title: dealTitle || "Novo lead",
    value: input.dealValue ?? 0,
  });

  revalidatePath("/crm");
  return { lead, deal };
}

// Sprint 3d: migra pra ActionResult — antes lancava em erro.
export async function updateDealStage(
  dealId: string,
  stageId: string,
): Promise<import("@persia/ui").ActionResult<void>> {
  try {
    const { supabase, orgId } = await requireRole("agent");

    // Movimentacao "rica" — passa por moveDealToStage que tambem dispara
    // activity log + onStageChanged flows + sync UAZAPI. NAO usa
    // moveDealKanban (que e versao leve so pra drag-drop).
    const { moveDealToStage } = await import("@/lib/crm/move-deal");
    const result = await moveDealToStage({
      dealId,
      stageId,
      orgId,
      source: "manual",
      supabase,
    });

    if (!result.ok) {
      return { error: result.error || "Não foi possível mover o negócio." };
    }

    // PR-K LEAD-SYNC: deal mudou de etapa -> tab Leads pode mudar
    // (status do lead pode ter sido atualizado, ou colunas Negocios/
    // Etapa atual no drawer/lista refletem). Antes deste PR, so /crm
    // revalidava — Tab Leads ficava desync.
    await revalidateLeadCaches();
    return;
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível mover o negócio.",
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
  const { supabase, orgId } = await requireRole("agent");
  await updateDealShared({ db: supabase, orgId }, dealId, {
    title: data.title,
    value: data.value,
    status: data.status,
    leadId: data.lead_id,
  });
  revalidatePath("/crm");
}

export async function deleteDeal(dealId: string) {
  const { supabase, orgId } = await requireRole("agent");
  await deleteDealShared({ db: supabase, orgId }, dealId);
  revalidatePath("/crm");
}

// ============ DEAL OPS (used by kanban) ============

export async function moveDeal(
  dealId: string,
  stageId: string,
  sortOrder: number,
) {
  const { supabase, orgId } = await requireRole("agent");
  await moveDealKanban({ db: supabase, orgId }, dealId, stageId, sortOrder);
  revalidatePath("/crm");
}

export async function updateDealStatus(dealId: string, status: string) {
  const { supabase, orgId } = await requireRole("agent");
  await updateDealStatusShared(
    { db: supabase, orgId },
    dealId,
    status as "open" | "won" | "lost",
  );
  revalidatePath("/crm");
}

// ============ LEADS (for deal assignment) ============

export async function getLeads() {
  const { supabase, orgId } = await requireRole("agent");
  return listLeadsForDealAssignment({ db: supabase, orgId });
}

// ============ AUTO-CREATE DEFAULT PIPELINE ============

export async function ensureDefaultPipeline() {
  const { supabase, orgId } = await requireRole("agent");
  const id = await ensureDefaultPipelineShared({ db: supabase, orgId });
  revalidatePath("/crm");
  return id;
}

// ============ BULK OPS (PR-K2) ============

/**
 * Move N deals pra mesma stage. Validacao no shared garante que TODOS
 * sao do mesmo pipeline da stage de destino. NAO dispara o flow rico
 * (activity log + onStageChanged + sync UAZAPI) — operacao em massa
 * usa update plano. Pra side-effects, mover individualmente.
 */
export async function bulkMoveDeals(dealIds: string[], stageId: string) {
  const { supabase, orgId } = await requireRole("agent");
  const result = await bulkMoveDealsToStageShared(
    { db: supabase, orgId },
    dealIds,
    stageId,
  );
  revalidatePath("/crm");
  return result;
}

/**
 * Marca N deals como won/lost/open de uma vez. Seta closed_at
 * automaticamente.
 */
export async function bulkSetDealStatus(
  dealIds: string[],
  status: "open" | "won" | "lost",
) {
  const { supabase, orgId } = await requireRole("agent");
  const result = await bulkUpdateDealStatusShared(
    { db: supabase, orgId },
    dealIds,
    status,
  );
  revalidatePath("/crm");
  return result;
}

/**
 * PR-AUDX: bulk delete e operacao critica + irreversivel. Eleva pra
 * `admin` (era `agent`) — agentes regulares nao deletam em massa.
 * Pra excluir 1 deal individual, continua via deleteDeal (agent).
 */
export async function bulkRemoveDeals(dealIds: string[]) {
  const { supabase, orgId } = await requireRole("admin");
  const result = await bulkDeleteDealsShared(
    { db: supabase, orgId },
    dealIds,
  );
  revalidatePath("/crm");
  return result;
}

/**
 * Aplica tags nas LEADS dos deals selecionados (nao no deal — tag eh
 * propriedade do lead). Idempotente (UNIQUE em lead_tags).
 */
export async function bulkApplyTagsToDeals(
  dealIds: string[],
  tagIds: string[],
) {
  const { supabase, orgId } = await requireRole("agent");
  const result = await bulkApplyTagsShared(
    { db: supabase, orgId },
    dealIds,
    tagIds,
  );
  revalidatePath("/crm");
  return result;
}

// ============ LOSS TRACKING (PR-K3) ============

/**
 * Lista motivos de perda cadastrados na org. Auto-seeda defaults
 * se vier vazio (first-touch).
 */
export async function getLossReasons() {
  const { supabase, orgId } = await requireRole("agent");
  return listLossReasonsShared({ db: supabase, orgId });
}

/**
 * Marca um deal como perdido capturando motivo + concorrente + nota
 * pra analytics. Atualiza status='lost' + closed_at + colunas loss.
 */
export async function markDealAsLost(
  dealId: string,
  input: MarkDealAsLostInput,
) {
  const { supabase, orgId } = await requireRole("agent");
  await markDealAsLostShared({ db: supabase, orgId }, dealId, input);
  revalidatePath("/crm");
}

/**
 * Marca varios deals como perdidos com mesmo motivo (bulk). Cap 200.
 *
 * PR-AUDX: operacao destrutiva pro funil (fecha N deals como lost,
 * impacta relatorios e taxa de conversao). Eleva pra `admin` —
 * agentes regulares marcam 1 a 1 via markDealAsLost.
 */
export async function bulkMarkDealsAsLost(
  dealIds: string[],
  input: MarkDealAsLostInput,
) {
  const { supabase, orgId } = await requireRole("admin");
  const result = await bulkMarkDealsAsLostShared(
    { db: supabase, orgId },
    dealIds,
    input,
  );
  revalidatePath("/crm");
  return result;
}

// ============ LOSS REASONS CRUD (PR-K4) ============
// Cadastro de motivos de perda — owner/admin gerenciam em /crm/settings.

export async function createLossReason(input: CreateLossReasonInput) {
  const { supabase, orgId } = await requireRole("admin");
  const result = await createLossReasonShared(
    { db: supabase, orgId },
    input,
  );
  revalidatePath("/crm/settings");
  revalidatePath("/crm");
  return result;
}

export async function updateLossReason(
  reasonId: string,
  input: UpdateLossReasonInput,
) {
  const { supabase, orgId } = await requireRole("admin");
  await updateLossReasonShared({ db: supabase, orgId }, reasonId, input);
  revalidatePath("/crm/settings");
  revalidatePath("/crm");
}

export async function deleteLossReason(reasonId: string) {
  const { supabase, orgId } = await requireRole("admin");
  await deleteLossReasonShared({ db: supabase, orgId }, reasonId);
  revalidatePath("/crm/settings");
  revalidatePath("/crm");
}
