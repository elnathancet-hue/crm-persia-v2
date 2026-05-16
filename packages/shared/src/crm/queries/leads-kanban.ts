// Leads Kanban — query principal do board lead-centric (FASE 1).
//
// Substitui `listDeals()` como fonte do Kanban. Cada lead aparece
// 1x; deals viram subentidade (contador + soma de valores opcional).
//
// PR-K-CENTRIC: regra de negocio nova (mai/2026). Lead e a entidade
// do Kanban, deal e historico comercial dentro do lead.

import type { CrmQueryContext } from "./context";

export interface ListLeadsKanbanOptions {
  /** Filtra por pipeline_id. Default: todos os leads do org. */
  pipelineId?: string;
  /** Incluir leads sem pipeline (NULL). Default: false. */
  includeUnassigned?: boolean;
}

/**
 * Lista leads do org com tags + responsavel embed + agregacao de deals
 * (count, total_value). Ordena por sort_order ASC (drag-drop Kanban).
 *
 * Performance: 1 query principal + 1 RPC opcional pra agregar deals
 * (se houver leads com many deals). Por enquanto, embed deals count
 * inline (sem agregacao de valor — `expected_value` no lead ja basta).
 */
export async function listLeadsKanban(
  ctx: CrmQueryContext,
  opts: ListLeadsKanbanOptions = {},
): Promise<unknown[]> {
  const { db, orgId } = ctx;

  let query = db
    .from("leads")
    .select(
      [
        "id",
        "name",
        "phone",
        "email",
        "avatar_url",
        "status",
        "source",
        "score",
        "channel",
        "pipeline_id",
        "stage_id",
        "sort_order",
        "expected_value",
        "assigned_to",
        "last_interaction_at",
        "created_at",
        "updated_at",
        // Embed tags
        "lead_tags(tags(id, name, color))",
        // Embed responsavel
        "assignee:profiles!leads_assigned_to_fkey(id, full_name)",
        // Embed deals (so id+status pra contar abertos/ganhos/perdidos no card)
        "deals(id, status, value)",
      ].join(", "),
    )
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (opts.pipelineId) {
    query = query.eq("pipeline_id", opts.pipelineId);
  } else if (!opts.includeUnassigned) {
    // Default: esconde leads sem funil (precisam ser triados antes)
    query = query.not("pipeline_id", "is", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface LeadStageContext {
  lead: { id: string; pipeline_id: string | null; stage_id: string | null };
  stages: Array<{
    id: string;
    name: string;
    color: string;
    outcome: "em_andamento" | "falha" | "bem_sucedido";
    sort_order: number;
  }>;
}

/**
 * Retorna o pipeline/stage atual do lead + todas as stages do pipeline
 * (pra UI do drawer "Informacoes do lead" — subheader clicavel que
 * troca etapa). Se o lead nao tem pipeline, retorna stages vazias.
 */
export async function findLeadStageContext(
  ctx: CrmQueryContext,
  leadId: string,
): Promise<LeadStageContext | null> {
  const { db, orgId } = ctx;

  const { data: lead, error: leadErr } = await db
    .from("leads")
    .select("id, pipeline_id, stage_id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (leadErr) throw new Error(leadErr.message);
  if (!lead) return null;

  const leadRow = lead as { id: string; pipeline_id: string | null; stage_id: string | null };

  if (!leadRow.pipeline_id) {
    return { lead: leadRow, stages: [] };
  }

  const { data: stages, error: stagesErr } = await db
    .from("pipeline_stages")
    .select("id, name, color, outcome, sort_order")
    .eq("pipeline_id", leadRow.pipeline_id)
    .order("sort_order", { ascending: true });

  if (stagesErr) throw new Error(stagesErr.message);

  return {
    lead: leadRow,
    stages: (stages ?? []) as LeadStageContext["stages"],
  };
}
