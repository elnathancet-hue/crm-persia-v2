// Deals — queries read-only compartilhadas.

import type { CrmQueryContext } from "./context";

export interface ListDealsOptions {
  /** Filtra por pipeline_id. Default: todos os deals do org. */
  pipelineId?: string;
}

/**
 * Lista deals do org com lead embed (id/name/phone/email/status + tags).
 * Ordena por sort_order ASC (compativel com drag-drop do Kanban).
 */
export async function listDeals(
  ctx: CrmQueryContext,
  opts: ListDealsOptions = {},
): Promise<unknown[]> {
  const { db, orgId } = ctx;

  // Embed do responsavel via assigned_to -> profiles(full_name).
  // Mostrado na linha "Responsavel" do card do Kanban (sem precisar
  // de query extra).
  //
  // PR-AUD4: select com colunas explicitas (era `*`). Tira colunas
  // pesadas que o Kanban nao renderiza (loss_reason, competitor,
  // loss_note, closed_at, archived_at). Reduz payload em ~30-50%
  // pra orgs com muitos deals.
  let query = db
    .from("deals")
    .select(
      [
        "id",
        "title",
        "value",
        "status",
        "lead_id",
        "pipeline_id",
        "stage_id",
        "sort_order",
        "updated_at",
        "created_at",
        "assigned_to",
        // Embed do lead (com tags + responsavel) — necessario pro card
        "leads(id, name, phone, email, status, assigned_to, lead_tags(tags(id, name, color)), assignee:profiles!leads_assigned_to_fkey(id, full_name))",
      ].join(", "),
    )
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (opts.pipelineId) {
    query = query.eq("pipeline_id", opts.pipelineId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export interface LeadOpenDealWithStages {
  deal: { id: string; pipeline_id: string; stage_id: string };
  stages: Array<{
    id: string;
    name: string;
    color: string;
    outcome: "em_andamento" | "falha" | "bem_sucedido";
    sort_order: number;
  }>;
}

/**
 * Retorna o deal aberto mais recente do lead + as stages do pipeline
 * desse deal (pra UI do drawer "Informacoes do lead" — subheader
 * clicavel que troca a etapa atual sem sair da pagina). Se o lead nao
 * tem nenhum deal aberto, retorna null.
 */
export async function findLeadOpenDealWithStages(
  ctx: CrmQueryContext,
  leadId: string,
): Promise<LeadOpenDealWithStages | null> {
  const { db, orgId } = ctx;

  const { data: deal } = await db
    .from("deals")
    .select("id, pipeline_id, stage_id, status")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!deal) return null;

  const { data: stages, error: stagesErr } = await db
    .from("pipeline_stages")
    .select("id, name, color, outcome, sort_order")
    .eq("pipeline_id", deal.pipeline_id as string)
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (stagesErr) throw new Error(stagesErr.message);

  return {
    deal: {
      id: deal.id as string,
      pipeline_id: deal.pipeline_id as string,
      stage_id: deal.stage_id as string,
    },
    stages: (stages ?? []) as LeadOpenDealWithStages["stages"],
  };
}
