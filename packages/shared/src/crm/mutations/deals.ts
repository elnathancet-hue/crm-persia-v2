// Deals — mutations CRUD compartilhadas.
//
// Throw on error. Wrappers nos apps adaptam pro shape historico.
// Movimentacao "rica" entre stages (com activity log + onStageChanged
// flows + sync UAZAPI) usa `moveDealToStage` em
// apps/crm/src/lib/crm/move-deal.ts. Esta funcao `moveDealKanban` daqui
// e mais leve (so muda stage_id + sort_order) e foi criada pra suportar
// drag-drop direto no Kanban onde o usuario reordena rapidamente.

import type { Deal } from "../types";
import type { CrmMutationContext } from "./context";

export interface CreateDealInput {
  pipelineId: string;
  stageId: string;
  title: string;
  value?: number;
  leadId?: string | null;
}

export interface UpdateDealInput {
  title?: string;
  value?: number;
  status?: string;
  leadId?: string | null;
}

export type DealStatus = "open" | "won" | "lost";

/**
 * Cria um deal. Valida ownership do pipeline, stage e lead (se
 * fornecido) — todos no mesmo org.
 */
export async function createDeal(
  ctx: CrmMutationContext,
  input: CreateDealInput,
): Promise<Deal> {
  const { db, orgId } = ctx;

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id, pipeline_id, organization_id")
    .eq("id", input.stageId)
    .eq("pipeline_id", input.pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!stage) {
    throw new Error("Etapa nao encontrada neste funil");
  }

  if (input.leadId) {
    const { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("id", input.leadId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!lead) {
      throw new Error("Lead nao encontrado nesta organizacao");
    }
  }

  const { data, error } = await db
    .from("deals")
    .insert({
      organization_id: orgId,
      pipeline_id: input.pipelineId,
      stage_id: input.stageId,
      lead_id: input.leadId || null,
      title: input.title,
      value: input.value ?? 0,
      status: "open",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Deal nao foi criado");
  return data as Deal;
}

/**
 * Atualiza campos do deal. So altera os passados. Quando `status` muda
 * pra won/lost, seta `closed_at` automaticamente; quando volta pra
 * "open", limpa o closed_at.
 */
export async function updateDeal(
  ctx: CrmMutationContext,
  dealId: string,
  input: UpdateDealInput,
): Promise<void> {
  const { db, orgId } = ctx;

  const updateData: Record<string, unknown> = {};
  if (input.title !== undefined) updateData.title = input.title;
  if (input.value !== undefined) updateData.value = input.value;
  if (input.status !== undefined) {
    updateData.status = input.status;
    updateData.closed_at =
      input.status !== "open" ? new Date().toISOString() : null;
  }
  if (input.leadId !== undefined) updateData.lead_id = input.leadId;

  if (Object.keys(updateData).length === 0) return;

  const { error } = await db
    .from("deals")
    .update(updateData)
    .eq("id", dealId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}

/**
 * Atualiza so o status (won/lost/open). Versao dedicada da updateDeal
 * pra calls de UI que so mexem no status (ex: botao "Marcar como
 * ganho").
 */
export async function updateDealStatus(
  ctx: CrmMutationContext,
  dealId: string,
  status: DealStatus,
): Promise<void> {
  return updateDeal(ctx, dealId, { status });
}

/**
 * Move o deal pra outra stage E atualiza sort_order — usado pelo
 * drag-drop do Kanban. Valida que a stage de destino esta no MESMO
 * pipeline do deal (evita mover entre pipelines silenciosamente).
 *
 * Pra movimentacao "rica" com activity log + flows + sync, ver
 * `moveDealToStage` em apps/crm/src/lib/crm/move-deal.ts (usado pelo
 * native AI Agent tool e pelo updateDealStage do CRM).
 */
export async function moveDealKanban(
  ctx: CrmMutationContext,
  dealId: string,
  stageId: string,
  sortOrder: number,
): Promise<void> {
  const { db, orgId } = ctx;

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id, pipeline_id")
    .eq("id", stageId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!stage) throw new Error("Stage nao encontrada nesta organizacao");

  const { data: deal } = await db
    .from("deals")
    .select("id, pipeline_id")
    .eq("id", dealId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!deal) throw new Error("Deal nao encontrado nesta organizacao");

  if ((deal as { pipeline_id: string }).pipeline_id !== (stage as { pipeline_id: string }).pipeline_id) {
    throw new Error("Stage de destino nao pertence ao mesmo funil do deal");
  }

  const { error } = await db
    .from("deals")
    .update({ stage_id: stageId, sort_order: sortOrder })
    .eq("id", dealId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}

export async function deleteDeal(
  ctx: CrmMutationContext,
  dealId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  const { error } = await db
    .from("deals")
    .delete()
    .eq("id", dealId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
}

// ============================================================================
// Bulk operations (PR-K2)
// ============================================================================

/**
 * Move VARIOS deals pra mesma stage. Valida que todos pertencem ao mesmo
 * pipeline da stage de destino (evita "vazar" deal entre pipelines).
 * sort_order nao eh tocado aqui — deals sao apendados no fim. Pra bulk
 * com reordering, fazer drag-drop individual.
 *
 * Limite de 200 deals por chamada — protege contra abuso e garante
 * latencia previsivel.
 */
export async function bulkMoveDealsToStage(
  ctx: CrmMutationContext,
  dealIds: string[],
  stageId: string,
): Promise<{ moved_count: number }> {
  const { db, orgId } = ctx;
  if (dealIds.length === 0) return { moved_count: 0 };
  if (dealIds.length > 200) {
    throw new Error("Maximo 200 negocios por operacao em massa.");
  }

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id, pipeline_id")
    .eq("id", stageId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!stage) throw new Error("Etapa de destino nao encontrada.");
  const targetPipeline = (stage as { pipeline_id: string }).pipeline_id;

  // Confirma que TODOS os deals sao do mesmo pipeline (evita move
  // cross-pipeline silencioso). Lista os ids invalidos pra erro util.
  const { data: deals } = await db
    .from("deals")
    .select("id, pipeline_id")
    .eq("organization_id", orgId)
    .in("id", dealIds);

  const found = (deals ?? []) as { id: string; pipeline_id: string }[];
  if (found.length !== dealIds.length) {
    throw new Error(
      `${dealIds.length - found.length} negocios nao foram encontrados nesta organizacao.`,
    );
  }
  const wrongPipeline = found.filter((d) => d.pipeline_id !== targetPipeline);
  if (wrongPipeline.length > 0) {
    throw new Error(
      `${wrongPipeline.length} negocio(s) sao de outro funil. Selecione apenas negocios do mesmo funil.`,
    );
  }

  const { error } = await db
    .from("deals")
    .update({ stage_id: stageId, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .in("id", dealIds);
  if (error) throw new Error(error.message);

  return { moved_count: dealIds.length };
}

/**
 * Atualiza status de varios deals (won/lost/open). Quando muda pra
 * won/lost, seta closed_at automaticamente; quando volta pra open,
 * limpa closed_at.
 */
export async function bulkUpdateDealStatus(
  ctx: CrmMutationContext,
  dealIds: string[],
  status: DealStatus,
): Promise<{ updated_count: number }> {
  const { db, orgId } = ctx;
  if (dealIds.length === 0) return { updated_count: 0 };
  if (dealIds.length > 200) {
    throw new Error("Maximo 200 negocios por operacao em massa.");
  }

  const closedAt = status === "open" ? null : new Date().toISOString();
  const { error } = await db
    .from("deals")
    .update({
      status,
      closed_at: closedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .in("id", dealIds);
  if (error) throw new Error(error.message);

  return { updated_count: dealIds.length };
}

/**
 * Deleta varios deals. Cascade pelo schema cuida das related rows.
 */
export async function bulkDeleteDeals(
  ctx: CrmMutationContext,
  dealIds: string[],
): Promise<{ deleted_count: number }> {
  const { db, orgId } = ctx;
  if (dealIds.length === 0) return { deleted_count: 0 };
  if (dealIds.length > 200) {
    throw new Error("Maximo 200 negocios por operacao em massa.");
  }

  const { error } = await db
    .from("deals")
    .delete()
    .eq("organization_id", orgId)
    .in("id", dealIds);
  if (error) throw new Error(error.message);

  return { deleted_count: dealIds.length };
}

/**
 * Aplica tags nas LEADS dos deals selecionados. Util pro bulk "Aplicar
 * tag" no Kanban — usuario seleciona N cards e aplica 1+ tag em todos.
 *
 * Detalhes:
 * - Resolve lead_id de cada deal (alguns podem ser null — pulamos).
 * - Valida que todas as tags pertencem a org (defense-in-depth).
 * - Upsert em lead_tags com onConflict ignoreDuplicates (tag ja
 *   aplicada nao duplica).
 */
export async function bulkApplyTagsToDealLeads(
  ctx: CrmMutationContext,
  dealIds: string[],
  tagIds: string[],
): Promise<{ leads_count: number; links_count: number }> {
  const { db, orgId } = ctx;
  if (dealIds.length === 0 || tagIds.length === 0) {
    return { leads_count: 0, links_count: 0 };
  }
  if (dealIds.length > 200) {
    throw new Error("Maximo 200 negocios por operacao em massa.");
  }

  // Valida tags da org (evita aplicar tag de outro tenant via id chumbado)
  const { data: tags } = await db
    .from("tags")
    .select("id")
    .eq("organization_id", orgId)
    .in("id", tagIds);
  const validTagIds = ((tags ?? []) as { id: string }[]).map((t) => t.id);
  if (validTagIds.length === 0) {
    throw new Error("Nenhuma tag valida encontrada nesta organizacao.");
  }

  // Resolve lead_id dos deals
  const { data: deals } = await db
    .from("deals")
    .select("id, lead_id")
    .eq("organization_id", orgId)
    .in("id", dealIds);
  const leadIds = Array.from(
    new Set(
      ((deals ?? []) as { id: string; lead_id: string | null }[])
        .map((d) => d.lead_id)
        .filter((id): id is string => id !== null),
    ),
  );
  if (leadIds.length === 0) return { leads_count: 0, links_count: 0 };

  const links: { organization_id: string; lead_id: string; tag_id: string }[] =
    [];
  for (const leadId of leadIds) {
    for (const tagId of validTagIds) {
      links.push({ organization_id: orgId, lead_id: leadId, tag_id: tagId });
    }
  }

  const { error } = await db
    .from("lead_tags")
    .upsert(links, {
      onConflict: "lead_id,tag_id",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(error.message);

  return { leads_count: leadIds.length, links_count: links.length };
}
