// Leads Kanban — mutations lead-centric (FASE 1).
//
// PR-K-CENTRIC (mai/2026): Kanban opera em LEAD, nao mais em deal.
// Essas funcoes substituem `moveDealKanban`, `bulkMoveDeals`,
// `bulkUpdateDealStatus`, `bulkMarkDealsAsLost`, `bulkDeleteDeals`
// quando o caller esta indexando por lead.
//
// Trigger DB `trg_lead_stage_status_sync` ja cuida de sincronizar
// `lead.status` com `outcome` do stage destino (falha → lost,
// bem_sucedido → customer). Aqui nao replicamos essa logica.
//
// Audit log: registra activities em `lead_activities` fire-and-forget.

import type { CrmMutationContext } from "./context";
import { sanitizeMutationError } from "./errors";

type BulkLeadActivityType =
  | "stage_change"
  | "pipeline_change"
  | "status_change"
  | "lead_lost"
  | "lead_won"
  | "lead_deleted";

interface LeadActivityInsert {
  lead_id: string;
  organization_id: string;
  type: BulkLeadActivityType;
  metadata: Record<string, unknown>;
}

async function logActivity(
  ctx: CrmMutationContext,
  entries: LeadActivityInsert[],
): Promise<void> {
  if (entries.length === 0) return;
  const { db } = ctx;
  // fire-and-forget — nao falha a mutation se log der erro
  void db
    .from("lead_activities")
    .insert(entries as never)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[leads-kanban] activity log failed:", error.message);
      }
    });
}

// ============================================================
// moveLeadToStage — drag-drop do Kanban
// ============================================================
//
// Move lead pra outra coluna (stage) DENTRO do mesmo pipeline.
// Atualiza sort_order pra posicao destino.
// Idempotente: se ja esta la, no-op.
//
// Trigger DB sincroniza lead.status se stage destino tem outcome
// 'falha' ou 'bem_sucedido'. Caller nao precisa setar status.

export async function moveLeadToStage(
  ctx: CrmMutationContext,
  leadId: string,
  stageId: string,
  sortOrder: number,
): Promise<void> {
  const { db, orgId } = ctx;

  const { data: stage, error: stageErr } = await db
    .from("pipeline_stages")
    .select("id, pipeline_id, name, outcome")
    .eq("id", stageId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (stageErr) throw sanitizeMutationError(stageErr.message);
  if (!stage) throw new Error("Etapa nao encontrada nesta organizacao");

  const { data: lead, error: leadErr } = await db
    .from("leads")
    .select("id, pipeline_id, stage_id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (leadErr) throw sanitizeMutationError(leadErr.message);
  if (!lead) throw new Error("Lead nao encontrado nesta organizacao");

  const stageRow = stage as { id: string; pipeline_id: string; name: string; outcome: string };
  const leadRow = lead as { id: string; pipeline_id: string | null; stage_id: string | null };

  // Validacao: stage destino deve estar no mesmo pipeline do lead
  // (se lead ja tem pipeline). Se lead nao tem pipeline, adota o
  // pipeline do stage destino.
  if (leadRow.pipeline_id && leadRow.pipeline_id !== stageRow.pipeline_id) {
    throw new Error(
      "Stage de destino nao pertence ao funil atual do lead. Use moveLeadToPipeline pra trocar de funil.",
    );
  }

  // Idempotencia
  if (leadRow.stage_id === stageId) {
    // Mesmo stage — so atualiza sort_order se mudou
    const { error: sortErr } = await db
      .from("leads")
      .update({ sort_order: sortOrder } as never)
      .eq("id", leadId);
    if (sortErr) throw sanitizeMutationError(sortErr.message);
    return;
  }

  const updateData = {
    stage_id: stageId,
    pipeline_id: stageRow.pipeline_id,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  };

  const { error: updateErr } = await db
    .from("leads")
    .update(updateData as never)
    .eq("id", leadId);

  if (updateErr) throw sanitizeMutationError(updateErr.message);

  await logActivity(ctx, [
    {
      lead_id: leadId,
      organization_id: orgId,
      type: "stage_change",
      metadata: {
        from_stage_id: leadRow.stage_id,
        to_stage_id: stageId,
        to_stage_name: stageRow.name,
        to_stage_outcome: stageRow.outcome,
      },
    },
  ]);
}

// ============================================================
// moveLeadToPipeline — troca de funil (drawer do lead)
// ============================================================
//
// Move lead pra outro pipeline + stage especifica desse pipeline.
// Usado quando user troca o funil do lead via UI (ex.: "Vendas" → "Pos-venda").

export async function moveLeadToPipeline(
  ctx: CrmMutationContext,
  leadId: string,
  pipelineId: string,
  stageId: string,
): Promise<void> {
  const { db, orgId } = ctx;

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id, pipeline_id, name, outcome")
    .eq("id", stageId)
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!stage) {
    throw new Error("Etapa nao pertence ao funil escolhido ou nao existe nesta organizacao");
  }

  const { data: lead } = await db
    .from("leads")
    .select("id, pipeline_id, stage_id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!lead) throw new Error("Lead nao encontrado nesta organizacao");

  const leadRow = lead as { id: string; pipeline_id: string | null; stage_id: string | null };
  const stageRow = stage as { id: string; pipeline_id: string; name: string; outcome: string };

  if (leadRow.pipeline_id === pipelineId && leadRow.stage_id === stageId) {
    return; // no-op
  }

  const { error: updateErr } = await db
    .from("leads")
    .update({
      pipeline_id: pipelineId,
      stage_id: stageId,
      sort_order: 0,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", leadId);

  if (updateErr) throw sanitizeMutationError(updateErr.message);

  await logActivity(ctx, [
    {
      lead_id: leadId,
      organization_id: orgId,
      type: "pipeline_change",
      metadata: {
        from_pipeline_id: leadRow.pipeline_id,
        to_pipeline_id: pipelineId,
        to_stage_id: stageId,
        to_stage_name: stageRow.name,
      },
    },
  ]);
}

// ============================================================
// Bulk operations
// ============================================================

const BULK_LIMIT = 200;

export async function bulkMoveLeads(
  ctx: CrmMutationContext,
  leadIds: string[],
  stageId: string,
): Promise<{ updated_count: number }> {
  const { db, orgId } = ctx;
  if (leadIds.length === 0) return { updated_count: 0 };
  if (leadIds.length > BULK_LIMIT) {
    throw new Error(`Maximo ${BULK_LIMIT} leads por operacao em massa.`);
  }

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id, pipeline_id, name, outcome")
    .eq("id", stageId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!stage) throw new Error("Etapa nao encontrada nesta organizacao");
  const stageRow = stage as { id: string; pipeline_id: string; name: string; outcome: string };

  // Move so leads que ja estao no MESMO pipeline (defesa)
  const { data: affected, error: updateErr } = await db
    .from("leads")
    .update({
      stage_id: stageId,
      sort_order: 0,
      updated_at: new Date().toISOString(),
    } as never)
    .in("id", leadIds)
    .eq("organization_id", orgId)
    .eq("pipeline_id", stageRow.pipeline_id)
    .select("id");

  if (updateErr) throw sanitizeMutationError(updateErr.message);
  const affectedIds = (affected as Array<{ id: string }> | null)?.map((r) => r.id) ?? [];

  await logActivity(
    ctx,
    affectedIds.map((id) => ({
      lead_id: id,
      organization_id: orgId,
      type: "stage_change" as const,
      metadata: {
        to_stage_id: stageId,
        to_stage_name: stageRow.name,
        to_stage_outcome: stageRow.outcome,
        bulk: true,
      },
    })),
  );

  return { updated_count: affectedIds.length };
}

export interface MarkLeadAsLostInput {
  loss_reason: string;
  competitor?: string | null;
  loss_note?: string | null;
}

export async function bulkMarkLeadsAsLost(
  ctx: CrmMutationContext,
  leadIds: string[],
  input: MarkLeadAsLostInput,
): Promise<{ updated_count: number }> {
  const { db, orgId } = ctx;
  if (leadIds.length === 0) return { updated_count: 0 };
  if (leadIds.length > BULK_LIMIT) {
    throw new Error(`Maximo ${BULK_LIMIT} leads por operacao em massa.`);
  }
  if (!input.loss_reason || input.loss_reason.trim().length === 0) {
    throw new Error("Motivo da perda eh obrigatorio.");
  }

  const trimmedReason = input.loss_reason.trim();
  const competitor = input.competitor ? input.competitor.trim() : null;
  const lossNote = input.loss_note ? input.loss_note.trim() : null;
  const now = new Date().toISOString();

  // Status='lost' direto. Trigger nao dispara aqui (nao muda stage_id).
  const { data: affected, error: updateErr } = await db
    .from("leads")
    .update({
      status: "lost",
      updated_at: now,
    } as never)
    .in("id", leadIds)
    .eq("organization_id", orgId)
    .select("id");

  if (updateErr) throw sanitizeMutationError(updateErr.message);
  const affectedIds = (affected as Array<{ id: string }> | null)?.map((r) => r.id) ?? [];

  await logActivity(
    ctx,
    affectedIds.map((id) => ({
      lead_id: id,
      organization_id: orgId,
      type: "lead_lost" as const,
      metadata: {
        loss_reason: trimmedReason,
        competitor,
        loss_note: lossNote,
        marked_at: now,
        bulk: true,
      },
    })),
  );

  return { updated_count: affectedIds.length };
}

export async function bulkMarkLeadsAsWon(
  ctx: CrmMutationContext,
  leadIds: string[],
): Promise<{ updated_count: number }> {
  const { db, orgId } = ctx;
  if (leadIds.length === 0) return { updated_count: 0 };
  if (leadIds.length > BULK_LIMIT) {
    throw new Error(`Maximo ${BULK_LIMIT} leads por operacao em massa.`);
  }

  const now = new Date().toISOString();

  const { data: affected, error: updateErr } = await db
    .from("leads")
    .update({
      status: "customer",
      updated_at: now,
    } as never)
    .in("id", leadIds)
    .eq("organization_id", orgId)
    .select("id");

  if (updateErr) throw sanitizeMutationError(updateErr.message);
  const affectedIds = (affected as Array<{ id: string }> | null)?.map((r) => r.id) ?? [];

  await logActivity(
    ctx,
    affectedIds.map((id) => ({
      lead_id: id,
      organization_id: orgId,
      type: "lead_won" as const,
      metadata: { marked_at: now, bulk: true },
    })),
  );

  return { updated_count: affectedIds.length };
}
