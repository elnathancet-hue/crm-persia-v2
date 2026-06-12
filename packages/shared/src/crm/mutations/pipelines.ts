// Pipelines + Stages — mutations CRUD compartilhadas.
//
// Throw on error. Wrappers nos apps adaptam pro shape historico de
// cada um (CRM throw, admin retorna `null` ou `{ error }`).

import type { Pipeline, Stage, StageOutcome } from "../types";
import type { CrmMutationContext } from "./context";
import { sanitizeMutationError } from "./errors";

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

  if (error) throw sanitizeMutationError(error, "Erro ao criar funil");
  if (!pipeline) throw new Error("Pipeline nao foi criado");

  const created = pipeline as Pipeline;

  if (withDefaultStages) {
    // Bulk insert: 1 round-trip ao invés de 6 INSERTs sequenciais.
    const { error: stagesErr } = await db.from("pipeline_stages").insert(
      DEFAULT_STAGES.map((s, i) => ({
        pipeline_id: created.id,
        organization_id: orgId,
        name: s.name,
        sort_order: i,
        color: s.color,
        outcome: s.outcome,
      })),
    );
    if (stagesErr) {
      // eslint-disable-next-line no-console
      console.error("[createPipeline] falhou ao criar stages default:", stagesErr.message);
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

  if (error) throw sanitizeMutationError(error, "Erro ao renomear funil");
}

/**
 * Deleta um pipeline em cascata (deals → stages → pipeline) via RPC
 * atomica (migration 077). Tudo numa unica transacao — sem risco de
 * stages/deals orfaos em caso de timeout.
 */
export async function deletePipeline(
  ctx: CrmMutationContext,
  pipelineId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  if (!db.rpc) throw new Error("db.rpc required for deletePipeline");
  const { error } = await db.rpc("delete_pipeline_cascade", {
    p_org_id: orgId,
    p_pipeline_id: pipelineId,
  });

  if (error) throw sanitizeMutationError(error, "Erro ao excluir funil");
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

  if (error) throw sanitizeMutationError(error, "Erro ao criar etapa");
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

  if (error) throw sanitizeMutationError(error, "Erro ao atualizar etapa");
}

/**
 * Reordena multiplas stages de uma vez (drag-drop) via RPC atomica
 * (migration 077). Todos os sort_orders mudam dentro de uma unica
 * transacao — sem risco de estado parcial em timeout.
 */
export async function updateStageOrder(
  ctx: CrmMutationContext,
  stages: Array<{ id: string; position: number }>,
): Promise<void> {
  const { db, orgId } = ctx;

  if (!db.rpc) throw new Error("db.rpc required for updateStageOrder");
  const { error } = await db.rpc("reorder_stages", {
    p_org_id: orgId,
    p_stages: stages,
  });

  if (error) throw sanitizeMutationError(error, "Erro ao reordenar etapas");
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

  if (error) throw sanitizeMutationError(error, "Erro ao excluir etapa");
}
