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
