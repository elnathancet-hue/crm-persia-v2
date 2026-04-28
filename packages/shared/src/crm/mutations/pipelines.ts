// Pipelines + Stages — mutations CRUD compartilhadas.
//
// Throw on error. Wrappers nos apps adaptam pro shape historico de
// cada um (CRM throw, admin retorna `null` ou `{ error }`).

import type { Pipeline, Stage, StageOutcome } from "../types";
import type { CrmMutationContext } from "./context";

// Stages padrao criadas pra todo pipeline novo. Cobre os 3 outcomes:
// 4 estagios "em andamento" (ciclo de vendas tipico), 1 "falha"
// (Perdido) e 1 "bem sucedido" (Fechado). UI do Kanban agrupa por
// outcome com headers coloridos.
const DEFAULT_STAGES: Array<{
  name: string;
  color: string;
  outcome: StageOutcome;
}> = [
  { name: "Novo", color: "#3b82f6", outcome: "em_andamento" },
  { name: "Contato", color: "#f59e0b", outcome: "em_andamento" },
  { name: "Qualificado", color: "#8b5cf6", outcome: "em_andamento" },
  { name: "Proposta", color: "#ec4899", outcome: "em_andamento" },
  { name: "Perdido", color: "#ef4444", outcome: "falha" },
  { name: "Fechado", color: "#22c55e", outcome: "bem_sucedido" },
];

const DEFAULT_PIPELINE_NAME = "Funil Principal";
const DEFAULT_STAGE_COLOR = "#6366f1";

export interface CreatePipelineOptions {
  /** Nome do pipeline. Default: "Funil Principal". */
  name?: string;
  /**
   * Cria as stages padrao automaticamente apos o pipeline. Default: true.
   * Passe `false` se for criar stages manualmente depois.
   */
  withDefaultStages?: boolean;
}

/**
 * Cria um pipeline e (por default) suas stages padrao. Throw se o
 * insert do pipeline falhar; ignora erros nos inserts das stages
 * (best-effort — o pipeline ja existe; cliente pode criar stages
 * manualmente se as defaults falharem).
 */
export async function createPipeline(
  ctx: CrmMutationContext,
  opts: CreatePipelineOptions = {},
): Promise<Pipeline> {
  const { db, orgId } = ctx;
  const name = opts.name || DEFAULT_PIPELINE_NAME;
  const withDefaultStages = opts.withDefaultStages ?? true;

  const { data: pipeline, error } = await db
    .from("pipelines")
    .insert({ organization_id: orgId, name })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!pipeline) throw new Error("Pipeline nao foi criado");

  const created = pipeline as Pipeline;

  if (withDefaultStages) {
    for (let i = 0; i < DEFAULT_STAGES.length; i++) {
      await db.from("pipeline_stages").insert({
        pipeline_id: created.id,
        organization_id: orgId,
        name: DEFAULT_STAGES[i].name,
        sort_order: i,
        color: DEFAULT_STAGES[i].color,
        outcome: DEFAULT_STAGES[i].outcome,
      });
    }
  }

  return created;
}

/**
 * Garante que existe ao menos um pipeline no org. Se ja existe, retorna
 * o id do mais antigo. Caso contrario, cria o pipeline default (com
 * stages padrao) e retorna o id novo. Idempotente — seguro chamar em
 * qualquer ponto de boot.
 */
export async function ensureDefaultPipeline(
  ctx: CrmMutationContext,
): Promise<string> {
  const { db, orgId } = ctx;

  const { data: existing } = await db
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id as string;

  const pipeline = await createPipeline(ctx, {});
  return pipeline.id;
}

export async function updatePipelineName(
  ctx: CrmMutationContext,
  pipelineId: string,
  name: string,
): Promise<void> {
  const { db, orgId } = ctx;

  const { error } = await db
    .from("pipelines")
    .update({ name })
    .eq("id", pipelineId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}

/**
 * Deleta um pipeline em cascata: deals → stages → pipeline. Cada step
 * eh org-scoped pra prevenir delete cross-tenant em service-role.
 */
export async function deletePipeline(
  ctx: CrmMutationContext,
  pipelineId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  // Valida ownership antes de qualquer delete
  const { data: pipeline } = await db
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!pipeline) throw new Error("Pipeline nao encontrado nesta organizacao");

  // 1. Pega ids de todas as stages (pra fazer delete em cascata nos deals)
  const { data: stages } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", orgId);

  // 2. Delete deals de cada stage
  if (stages) {
    for (const stage of stages as { id: string }[]) {
      await db
        .from("deals")
        .delete()
        .eq("stage_id", stage.id)
        .eq("organization_id", orgId);
    }
  }

  // 3. Delete stages do pipeline
  await db
    .from("pipeline_stages")
    .delete()
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", orgId);

  // 4. Delete pipeline
  const { error } = await db
    .from("pipelines")
    .delete()
    .eq("id", pipelineId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}

// ============================================================================
// Stages
// ============================================================================

export interface CreateStageInput {
  pipelineId: string;
  name: string;
  sortOrder: number;
  color?: string;
  /** Categoria terminal — agrupa a stage no Kanban. Default em_andamento. */
  outcome?: StageOutcome;
}

export interface UpdateStageInput {
  name?: string;
  color?: string;
  sortOrder?: number;
  description?: string | null;
  /** Move a stage entre os 3 buckets (em_andamento/falha/bem_sucedido). */
  outcome?: StageOutcome;
}

export async function createStage(
  ctx: CrmMutationContext,
  input: CreateStageInput,
): Promise<Stage> {
  const { db, orgId } = ctx;

  // Valida pipeline pertence ao org
  const { data: pipeline } = await db
    .from("pipelines")
    .select("id")
    .eq("id", input.pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!pipeline) {
    throw new Error("Pipeline nao encontrado nesta organizacao");
  }

  const { data, error } = await db
    .from("pipeline_stages")
    .insert({
      pipeline_id: input.pipelineId,
      organization_id: orgId,
      name: input.name,
      sort_order: input.sortOrder,
      color: input.color || DEFAULT_STAGE_COLOR,
      outcome: input.outcome ?? "em_andamento",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Stage nao foi criada");
  return data as Stage;
}

export async function updateStage(
  ctx: CrmMutationContext,
  stageId: string,
  input: UpdateStageInput,
): Promise<void> {
  const { db, orgId } = ctx;

  // Valida stage pertence ao org
  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("id", stageId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!stage) throw new Error("Stage nao encontrada nesta organizacao");

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.color !== undefined) updateData.color = input.color;
  if (input.sortOrder !== undefined) updateData.sort_order = input.sortOrder;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.outcome !== undefined) updateData.outcome = input.outcome;

  if (Object.keys(updateData).length === 0) return;

  const { error } = await db
    .from("pipeline_stages")
    .update(updateData)
    .eq("id", stageId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}

/**
 * Reordena multiplas stages de uma vez (drag-drop). Cada item do array
 * tem `id` e `position` (que vira sort_order). Updates serializados pra
 * evitar race em RLS — performance OK pra ate ~50 stages.
 */
export async function updateStageOrder(
  ctx: CrmMutationContext,
  stages: Array<{ id: string; position: number }>,
): Promise<void> {
  const { db, orgId } = ctx;

  for (const stage of stages) {
    await db
      .from("pipeline_stages")
      .update({ sort_order: stage.position })
      .eq("id", stage.id)
      .eq("organization_id", orgId);
  }
}

/**
 * Deleta uma stage e cascata os deals dela. Org-scoping via lookup
 * antes pra defesa em profundidade.
 */
export async function deleteStage(
  ctx: CrmMutationContext,
  stageId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("id", stageId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!stage) throw new Error("Stage nao encontrada nesta organizacao");

  await db
    .from("deals")
    .delete()
    .eq("stage_id", stageId)
    .eq("organization_id", orgId);

  const { error } = await db
    .from("pipeline_stages")
    .delete()
    .eq("id", stageId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}
