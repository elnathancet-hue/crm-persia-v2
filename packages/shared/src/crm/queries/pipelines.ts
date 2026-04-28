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
