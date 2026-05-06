// Pipelines + Stages — queries read-only compartilhadas.

import type { Pipeline, PipelineWithStagesAndDeals, Stage } from "../types";
import type { CrmQueryContext } from "./context";

export interface ListPipelinesOptions {
  /**
   * Inclui pipeline_stages embed + deals embed por stage. Admin usa
   * pra montar o Kanban full-featured. CRM nao precisa nesse path
   * (usa queries separadas em getStages/getDeals).
   * Default: false.
   */
  withStagesAndDeals?: boolean;
}

/**
 * Lista pipelines do org. Sem withStagesAndDeals retorna so a metadata
 * (id, name, ...). Com a flag, faz join nested pra view do Kanban.
 */
export async function listPipelines(
  ctx: CrmQueryContext,
  opts: ListPipelinesOptions = {},
): Promise<Pipeline[] | PipelineWithStagesAndDeals[]> {
  const { db, orgId } = ctx;
  const select = opts.withStagesAndDeals
    ? "*, pipeline_stages(*, deals(*))"
    : "*";

  const { data, error } = await db
    .from("pipelines")
    .select(select)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Pipeline[] | PipelineWithStagesAndDeals[];
}

/**
 * Lista stages de um pipeline. Valida que o pipeline pertence ao org
 * antes — defesa em profundidade. Retorna [] se o pipeline nao
 * pertence ao org (em vez de throw — comportamento historico do CRM).
 */
export async function listStages(
  ctx: CrmQueryContext,
  pipelineId: string,
): Promise<Stage[]> {
  const { db, orgId } = ctx;

  const { data: pipeline } = await db
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!pipeline) return [];

  const { data, error } = await db
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Stage[];
}

/**
 * PR-CRMOPS4: resolve "primeiro pipeline + primeira stage em_andamento"
 * pra criar deal automatico quando lead novo aparece (Tab Leads,
 * Webhook UAZAPI, etc). Garante que o lead nao fica orfao no Kanban.
 *
 * Retorna null em 2 casos:
 *   - org nao tem nenhum pipeline (apesar do ensureDefaultPipeline,
 *     pode acontecer em edge cases)
 *   - pipeline nao tem nenhuma stage com outcome="em_andamento"
 *     (config quebrada — caller decide se cria sem deal ou throw)
 *
 * Ordem usada:
 *   1. Pipeline mais antigo (created_at ASC) — historicamente o
 *      "Funil Principal".
 *   2. Stage com outcome="em_andamento" + menor sort_order. Se o
 *      pipeline so tiver stages de outcome="falha"/"bem_sucedido"
 *      (improvavel), retorna null.
 */
export async function getDefaultPipelineStage(
  ctx: CrmQueryContext,
): Promise<{ pipelineId: string; stageId: string } | null> {
  const { db, orgId } = ctx;

  const { data: pipeline } = await db
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!pipeline) return null;
  const pipelineId = (pipeline as { id: string }).id;

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipelineId)
    .eq("outcome", "em_andamento")
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!stage) return null;
  return { pipelineId, stageId: (stage as { id: string }).id };
}

/**
 * Lista todas as stages do org (sem filtrar por pipeline). Util pra
 * seletores cross-pipeline. Ordena por sort_order ASC.
 */
export async function listStagesForOrg(
  ctx: CrmQueryContext,
): Promise<Stage[]> {
  const { db, orgId } = ctx;

  const { data, error } = await db
    .from("pipeline_stages")
    .select("*")
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Stage[];
}
