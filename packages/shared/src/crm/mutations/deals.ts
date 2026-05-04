// Deals — mutations CRUD compartilhadas.
//
// Throw on error. Wrappers nos apps adaptam pro shape historico.
// Movimentacao "rica" entre stages (com activity log + onStageChanged
// flows + sync UAZAPI) usa `moveDealToStage` em
// apps/crm/src/lib/crm/move-deal.ts. Esta funcao `moveDealKanban` daqui
// e mais leve (so muda stage_id + sort_order) e foi criada pra suportar
// drag-drop direto no Kanban onde o usuario reordena rapidamente.
//
// Audit log (PR-AUDX): mutations destrutivas/em massa logam no
// `lead_activities` fire-and-forget (mesmo padrao do move-deal.ts).
// Erros de log NAO falham a operacao — sao reportados via console.error
// pra debugging mas a UX fica intacta.

import type { Deal } from "../types";
import type { CrmMutationContext } from "./context";
import { sanitizeMutationError } from "./errors";

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

// Activity types emitidos por bulk ops. Mantem em sync com a coluna
// `lead_activities.type` (text livre, sem enum no schema).
type BulkActivityType =
  | "stage_change"
  | "status_change"
  | "deal_deleted"
  | "deal_lost"
  | "tag_applied";

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

  if (error) throw sanitizeMutationError(error, "Erro ao criar negocio");
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

  if (error) throw sanitizeMutationError(error, "Erro ao atualizar negocio");
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
 * PR-AUDX: agora loga em lead_activities (antes nao logava — drag-drop
 * passava em silencio na timeline do lead). Pra movimentacao "rica" com
 * flows + sync, ver `moveDealToStage` em apps/crm/src/lib/crm/move-deal.ts.
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
    .select("id, pipeline_id, name")
    .eq("id", stageId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!stage) throw new Error("Stage nao encontrada nesta organizacao");

  const { data: deal } = await db
    .from("deals")
    .select("id, pipeline_id, lead_id, stage_id")
    .eq("id", dealId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!deal) throw new Error("Deal nao encontrado nesta organizacao");

  const dealRow = deal as { id: string; pipeline_id: string; lead_id: string | null; stage_id: string | null };
  const stageRow = stage as { id: string; pipeline_id: string; name: string };

  if (dealRow.pipeline_id !== stageRow.pipeline_id) {
    throw new Error("Stage de destino nao pertence ao mesmo funil do deal");
  }

  // Idempotency — se ja esta na stage de destino, so atualiza sort_order
  // sem logar mudanca de etapa (evita poluir timeline).
  const sameStage = dealRow.stage_id === stageId;

  const { error } = await db
    .from("deals")
    .update({ stage_id: stageId, sort_order: sortOrder })
    .eq("id", dealId)
    .eq("organization_id", orgId);

  if (error) throw sanitizeMutationError(error, "Erro ao mover negocio");

  if (!sameStage && dealRow.lead_id) {
    // Resolve nome da stage origem pra mensagem amigavel.
    let fromStageName: string | null = null;
    if (dealRow.stage_id) {
      const { data: fromStage } = await db
        .from("pipeline_stages")
        .select("name")
        .eq("id", dealRow.stage_id)
        .eq("organization_id", orgId)
        .maybeSingle();
      fromStageName = (fromStage as { name: string } | null)?.name ?? null;
    }
    await logActivityFireAndForget(ctx, {
      lead_id: dealRow.lead_id,
      type: "stage_change",
      description: fromStageName
        ? `Movido de "${fromStageName}" para "${stageRow.name}" (Kanban)`
        : `Movido para "${stageRow.name}" (Kanban)`,
      metadata: {
        source: "kanban_drag",
        deal_id: dealId,
        from_stage_id: dealRow.stage_id,
        from_stage: fromStageName,
        to_stage_id: stageId,
        to_stage: stageRow.name,
      },
    });
  }
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

  if (error) throw sanitizeMutationError(error, "Erro ao excluir negocio");
}

// ============================================================================
// Loss reasons CRUD (PR-K4) — gerencia o catalogo cadastravel
// ============================================================================

export interface CreateLossReasonInput {
  label: string;
  requires_competitor?: boolean;
  sort_order?: number;
}

export interface UpdateLossReasonInput {
  label?: string;
  requires_competitor?: boolean;
  sort_order?: number;
  is_active?: boolean;
}

export async function createLossReason(
  ctx: CrmMutationContext,
  input: CreateLossReasonInput,
): Promise<{ id: string }> {
  const { db, orgId } = ctx;
  const trimmedLabel = input.label.trim();
  if (!trimmedLabel) throw new Error("Nome do motivo eh obrigatorio.");

  const { data, error } = await db
    .from("deal_loss_reasons")
    .insert({
      organization_id: orgId,
      label: trimmedLabel,
      requires_competitor: input.requires_competitor ?? false,
      sort_order: input.sort_order ?? 100,
    })
    .select("id")
    .single();

  if (error) {
    // Violacao de UNIQUE(org, label) — mensagem amigavel especifica
    if (error.code === "23505" || error.message?.includes("duplicate key")) {
      throw new Error(`Ja existe um motivo "${trimmedLabel}".`);
    }
    throw sanitizeMutationError(error, "Erro ao criar motivo de perda");
  }
  return data as { id: string };
}

export async function updateLossReason(
  ctx: CrmMutationContext,
  reasonId: string,
  input: UpdateLossReasonInput,
): Promise<void> {
  const { db, orgId } = ctx;
  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) {
    const t = input.label.trim();
    if (!t) throw new Error("Nome do motivo nao pode ser vazio.");
    patch.label = t;
  }
  if (input.requires_competitor !== undefined) {
    patch.requires_competitor = input.requires_competitor;
  }
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (Object.keys(patch).length === 0) return;

  const { error } = await db
    .from("deal_loss_reasons")
    .update(patch)
    .eq("id", reasonId)
    .eq("organization_id", orgId);
  if (error) throw sanitizeMutationError(error, "Erro ao atualizar motivo de perda");
}

/**
 * Soft delete: marca is_active=false. Mantem historico nos deals
 * que ja foram marcados com esse motivo.
 */
export async function deleteLossReason(
  ctx: CrmMutationContext,
  reasonId: string,
): Promise<void> {
  const { db, orgId } = ctx;
  const { error } = await db
    .from("deal_loss_reasons")
    .update({ is_active: false })
    .eq("id", reasonId)
    .eq("organization_id", orgId);
  if (error) throw sanitizeMutationError(error, "Erro ao excluir motivo de perda");
}

// ============================================================================
// Loss tracking (PR-K3)
// ============================================================================

export interface MarkDealAsLostInput {
  loss_reason: string;
  competitor?: string | null;
  loss_note?: string | null;
}

/**
 * Marca um deal como perdido capturando motivo, concorrente e nota
 * pra analytics. Seta status='lost' + closed_at = now() + colunas
 * de loss tracking. Idempotente — se ja for lost, atualiza apenas
 * os campos de motivo.
 */
export async function markDealAsLost(
  ctx: CrmMutationContext,
  dealId: string,
  input: MarkDealAsLostInput,
): Promise<void> {
  const { db, orgId } = ctx;

  if (!input.loss_reason || input.loss_reason.trim().length === 0) {
    throw new Error("Motivo da perda eh obrigatorio.");
  }

  const { error } = await db
    .from("deals")
    .update({
      status: "lost",
      closed_at: new Date().toISOString(),
      loss_reason: input.loss_reason.trim(),
      competitor: input.competitor ? input.competitor.trim() : null,
      loss_note: input.loss_note ? input.loss_note.trim() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId)
    .eq("organization_id", orgId);

  if (error) throw sanitizeMutationError(error, "Erro ao marcar negocio como perdido");
}

/**
 * Marca varios deals como perdidos com mesmo motivo (bulk). UI typica:
 * usuario seleciona N deals, escolhe motivo + concorrente uma vez,
 * aplica em todos. Cap de 200.
 *
 * PR-AUDX:
 * - Usa `.select("id")` pra retornar count REAL (nao otimista). Antes
 *   retornava `dealIds.length` mesmo quando RLS/delete cortava o set.
 * - Loga 1 entry em lead_activities por deal afetado (fire-and-forget).
 */
export async function bulkMarkDealsAsLost(
  ctx: CrmMutationContext,
  dealIds: string[],
  input: MarkDealAsLostInput,
): Promise<{ updated_count: number }> {
  const { db, orgId } = ctx;
  if (dealIds.length === 0) return { updated_count: 0 };
  if (dealIds.length > 200) {
    throw new Error("Maximo 200 negocios por operacao em massa.");
  }
  if (!input.loss_reason || input.loss_reason.trim().length === 0) {
    throw new Error("Motivo da perda eh obrigatorio.");
  }

  const trimmedReason = input.loss_reason.trim();
  const competitor = input.competitor ? input.competitor.trim() : null;
  const lossNote = input.loss_note ? input.loss_note.trim() : null;
  const now = new Date().toISOString();

  const { data: updated, error } = await db
    .from("deals")
    .update({
      status: "lost",
      closed_at: now,
      loss_reason: trimmedReason,
      competitor,
      loss_note: lossNote,
      updated_at: now,
    })
    .eq("organization_id", orgId)
    .in("id", dealIds)
    .select("id, lead_id");

  if (error) throw sanitizeMutationError(error, "Erro ao marcar negocios como perdidos");

  const rows = (updated ?? []) as { id: string; lead_id: string | null }[];

  // Audit log fire-and-forget — 1 entry por deal com lead.
  await logBulkActivities(
    ctx,
    rows
      .filter((r): r is { id: string; lead_id: string } => r.lead_id !== null)
      .map((r) => ({
        lead_id: r.lead_id,
        type: "deal_lost" as const,
        description: `Marcado como perdido: ${trimmedReason}`,
        metadata: {
          source: "bulk_mark_lost",
          deal_id: r.id,
          loss_reason: trimmedReason,
          ...(competitor ? { competitor } : {}),
          ...(lossNote ? { loss_note: lossNote } : {}),
        },
      })),
  );

  return { updated_count: rows.length };
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
 *
 * PR-AUDX: count real via .select("id") + audit log em lead_activities.
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
    .select("id, pipeline_id, name")
    .eq("id", stageId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!stage) throw new Error("Etapa de destino nao encontrada.");
  const stageRow = stage as { id: string; pipeline_id: string; name: string };

  // Confirma que TODOS os deals sao do mesmo pipeline (evita move
  // cross-pipeline silencioso). Lista os ids invalidos pra erro util.
  const { data: deals } = await db
    .from("deals")
    .select("id, pipeline_id, lead_id, stage_id")
    .eq("organization_id", orgId)
    .in("id", dealIds);

  const found = (deals ?? []) as {
    id: string;
    pipeline_id: string;
    lead_id: string | null;
    stage_id: string | null;
  }[];
  if (found.length !== dealIds.length) {
    throw new Error(
      `${dealIds.length - found.length} negocios nao foram encontrados nesta organizacao.`,
    );
  }
  const wrongPipeline = found.filter((d) => d.pipeline_id !== stageRow.pipeline_id);
  if (wrongPipeline.length > 0) {
    throw new Error(
      `${wrongPipeline.length} negocio(s) sao de outro funil. Selecione apenas negocios do mesmo funil.`,
    );
  }

  const { data: updated, error } = await db
    .from("deals")
    .update({ stage_id: stageId, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .in("id", dealIds)
    .select("id");
  if (error) throw sanitizeMutationError(error, "Erro ao mover negocios");

  const updatedRows = (updated ?? []) as { id: string }[];
  const updatedIds = new Set(updatedRows.map((r) => r.id));
  const dealsAffected = found.filter((d) => updatedIds.has(d.id));

  await logBulkActivities(
    ctx,
    dealsAffected
      .filter((d): d is typeof d & { lead_id: string } => d.lead_id !== null)
      .map((d) => ({
        lead_id: d.lead_id,
        type: "stage_change" as const,
        description: `Movido para "${stageRow.name}" (bulk)`,
        metadata: {
          source: "bulk_move",
          deal_id: d.id,
          from_stage_id: d.stage_id,
          to_stage_id: stageId,
          to_stage: stageRow.name,
        },
      })),
  );

  return { moved_count: updatedRows.length };
}

/**
 * Atualiza status de varios deals (won/lost/open). Quando muda pra
 * won/lost, seta closed_at automaticamente; quando volta pra open,
 * limpa closed_at.
 *
 * PR-AUDX: count real + audit log.
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
  const { data: updated, error } = await db
    .from("deals")
    .update({
      status,
      closed_at: closedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .in("id", dealIds)
    .select("id, lead_id");
  if (error) throw sanitizeMutationError(error, "Erro ao atualizar status dos negocios");

  const rows = (updated ?? []) as { id: string; lead_id: string | null }[];

  const statusLabel =
    status === "won" ? "ganho" : status === "lost" ? "perdido" : "em aberto";

  await logBulkActivities(
    ctx,
    rows
      .filter((r): r is { id: string; lead_id: string } => r.lead_id !== null)
      .map((r) => ({
        lead_id: r.lead_id,
        type: "status_change" as const,
        description: `Marcado como ${statusLabel} (bulk)`,
        metadata: {
          source: "bulk_status",
          deal_id: r.id,
          status,
        },
      })),
  );

  return { updated_count: rows.length };
}

/**
 * Deleta varios deals. Cascade pelo schema cuida das related rows.
 *
 * PR-AUDX:
 * - Operacao critica: caller deve exigir role >= admin.
 * - Captura lead_id ANTES do delete pra poder logar (depois do delete
 *   o registro some).
 * - count real via .select("id") no delete.
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

  // Captura lead_id antes pra logar — o delete os apaga.
  const { data: preDeleteSnapshot } = await db
    .from("deals")
    .select("id, lead_id, title")
    .eq("organization_id", orgId)
    .in("id", dealIds);
  const snapshot = (preDeleteSnapshot ?? []) as {
    id: string;
    lead_id: string | null;
    title: string | null;
  }[];

  const { data: deleted, error } = await db
    .from("deals")
    .delete()
    .eq("organization_id", orgId)
    .in("id", dealIds)
    .select("id");
  if (error) throw sanitizeMutationError(error, "Erro ao excluir negocios");

  const deletedRows = (deleted ?? []) as { id: string }[];
  const deletedIds = new Set(deletedRows.map((r) => r.id));
  const reallyDeleted = snapshot.filter((d) => deletedIds.has(d.id));

  await logBulkActivities(
    ctx,
    reallyDeleted
      .filter((d): d is typeof d & { lead_id: string } => d.lead_id !== null)
      .map((d) => ({
        lead_id: d.lead_id,
        type: "deal_deleted" as const,
        description: d.title
          ? `Negocio excluido: "${d.title}"`
          : "Negocio excluido (bulk)",
        metadata: {
          source: "bulk_delete",
          deal_id: d.id,
          ...(d.title ? { title: d.title } : {}),
        },
      })),
  );

  return { deleted_count: deletedRows.length };
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
 *
 * PR-AUDX: audit log por lead afetado.
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
    .select("id, name")
    .eq("organization_id", orgId)
    .in("id", tagIds);
  const validTags = ((tags ?? []) as { id: string; name: string }[]);
  const validTagIds = validTags.map((t) => t.id);
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
  if (error) throw sanitizeMutationError(error, "Erro ao aplicar tags");

  const tagNames = validTags.map((t) => t.name);
  await logBulkActivities(
    ctx,
    leadIds.map((leadId) => ({
      lead_id: leadId,
      type: "tag_applied" as const,
      description:
        tagNames.length === 1
          ? `Tag "${tagNames[0]}" aplicada (bulk)`
          : `${tagNames.length} tags aplicadas (bulk)`,
      metadata: {
        source: "bulk_tag",
        tag_ids: validTagIds,
        tag_names: tagNames,
      },
    })),
  );

  return { leads_count: leadIds.length, links_count: links.length };
}

// ============================================================================
// Audit log helpers (PR-AUDX)
// ============================================================================

interface ActivityEntry {
  lead_id: string;
  type: BulkActivityType;
  description: string;
  metadata: Record<string, unknown>;
}

/**
 * Loga 1 activity no lead_activities (fire-and-forget). Usado por
 * mutations individuais (moveDealKanban). Erro nao falha a operacao —
 * vai pro console.error pra debugging.
 */
async function logActivityFireAndForget(
  ctx: CrmMutationContext,
  entry: ActivityEntry,
): Promise<void> {
  try {
    const { error } = await ctx.db
      .from("lead_activities")
      .insert({
        lead_id: entry.lead_id,
        organization_id: ctx.orgId,
        type: entry.type,
        description: entry.description,
        metadata: entry.metadata,
      });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[crm-audit] activity log failed:", error.message);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[crm-audit] activity log threw:", err);
  }
}

/**
 * Loga N activities em batch. Mesmo padrao do single mas pra bulk ops.
 * Cap de 500 entries por insert — se vier mais, particiona.
 */
async function logBulkActivities(
  ctx: CrmMutationContext,
  entries: ActivityEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    lead_id: e.lead_id,
    organization_id: ctx.orgId,
    type: e.type,
    description: e.description,
    metadata: e.metadata,
  }));
  // Particiona em chunks de 500 — defesa contra payloads gigantes.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    try {
      const { error } = await ctx.db.from("lead_activities").insert(chunk);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[crm-audit] bulk activity log failed:", error.message);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[crm-audit] bulk activity log threw:", err);
    }
  }
}
