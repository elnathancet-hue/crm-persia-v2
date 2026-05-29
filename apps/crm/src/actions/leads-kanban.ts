"use server";

// Server actions lead-centric do Kanban (PR-K-CENTRIC mai/2026).
//
// Wrappers thin em volta de packages/shared/src/crm/mutations/leads-kanban.ts
// + auth requireRole("agent") + revalidatePath.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { revalidateLeadCaches } from "@/lib/cache/lead-revalidation";
import {
  bulkMarkLeadsAsLost as bulkMarkLeadsAsLostShared,
  bulkMarkLeadsAsWon as bulkMarkLeadsAsWonShared,
  bulkMoveLeads as bulkMoveLeadsShared,
  createDeal as createDealShared,
  createLead as createLeadShared,
  deleteDeal as deleteDealShared,
  findLeadStageContext as findLeadStageContextShared,
  listPipelines as listPipelinesShared,
  listStages as listStagesShared,
  moveLeadToPipeline as moveLeadToPipelineShared,
  moveLeadToStage as moveLeadToStageShared,
  sanitizeMutationError,
  updateDeal as updateDealShared,
  type MarkLeadAsLostInput,
} from "@persia/shared/crm";
import type { ActionResult } from "@persia/ui";

function asErrorMessage(err: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ============================================================
// createLeadInPipeline — cria lead direto em pipeline/stage
// ============================================================

export interface CreateLeadInPipelineInput {
  lead: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    source?: string;
    status?: string;
    channel?: string;
    expected_value?: number | null;
  };
  pipelineId: string;
  stageId: string;
}

export async function createLeadInPipeline(
  input: CreateLeadInPipelineInput,
): Promise<{ lead: { id: string } }> {
  const { supabase, orgId } = await requireRole("agent");

  const created = await createLeadShared(
    { db: supabase, orgId },
    {
      name: input.lead.name ?? null,
      phone: input.lead.phone ?? null,
      email: input.lead.email ?? null,
      source: input.lead.source ?? "manual",
      status: input.lead.status ?? "new",
      channel: input.lead.channel ?? "manual",
    },
  );

  // Vincular pipeline/stage + expected_value direto (createLead nao aceita esses)
  const { error: updErr } = await supabase
    .from("leads")
    .update({
      pipeline_id: input.pipelineId,
      stage_id: input.stageId,
      sort_order: 0,
      expected_value: input.lead.expected_value ?? null,
    })
    .eq("id", created.id)
    .eq("organization_id", orgId);

  if (updErr) {
    throw new Error(`Lead criado mas falhou ao vincular ao funil: ${updErr.message}`);
  }

  revalidateLeadCaches();
  revalidatePath("/crm");
  return { lead: { id: created.id } };
}

// ============================================================
// moveLeadStage — drag-drop
// ============================================================

export async function moveLeadStage(
  leadId: string,
  stageId: string,
  sortOrder: number,
): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  await moveLeadToStageShared({ db: supabase, orgId }, leadId, stageId, sortOrder);

  // PR-FLOW-PIVOT PR 11 (mai/2026): dispara agent_flows com entry
  // pipeline_stage_entered. Fire-and-forget — drag-drop do Kanban
  // continua responsivo mesmo se flow demorar.
  void import("@/lib/ai-agent/flow/triggers")
    .then(({ triggerAgentFlowsForStageEntry }) =>
      triggerAgentFlowsForStageEntry(supabase, orgId, leadId, stageId),
    )
    .catch((err) => {
      console.error(
        "[moveLeadStage] triggerAgentFlowsForStageEntry failed:",
        err,
      );
    });

  revalidatePath("/crm");
}

// ============================================================
// moveLeadToPipeline — troca de funil via drawer
// ============================================================

export async function moveLeadToPipeline(
  leadId: string,
  pipelineId: string,
  stageId: string,
): Promise<void> {
  const { supabase, orgId } = await requireRole("agent");
  await moveLeadToPipelineShared(
    { db: supabase, orgId },
    leadId,
    pipelineId,
    stageId,
  );
  revalidatePath("/crm");
}

// ============================================================
// searchLeadsForKanban — busca leads pra aba "Existente" do "+"
// do Kanban. mai/2026.
//
// Cliente reportou que o botao "+" do Kanban so cria lead novo —
// nao tem opcao de puxar lead ja existente (criado por WhatsApp/
// import). Esta action retorna leads da org que casam com a query
// (nome/telefone/email), com indicacao se ja estao em algum funil.
// ============================================================

export interface KanbanLeadSearchResult {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** null = lead esta sem funil/etapa. Quando preenchido, mostra
   *  ao cliente em qual funil/etapa o lead esta hoje pra ele
   *  decidir se quer mover. */
  current_pipeline_name: string | null;
  current_stage_name: string | null;
  current_pipeline_id: string | null;
  current_stage_id: string | null;
}

export async function searchLeadsForKanban(
  query: string,
  limit: number = 20,
): Promise<KanbanLeadSearchResult[]> {
  const { supabase, orgId } = await requireRole("agent");

  // Normaliza query — remove espacos extras + escapa wildcards SQL.
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  // Limita pra evitar full-table scan acidental. 200 e o cap do shared.
  const safeLimit = Math.max(1, Math.min(50, limit));

  // ILIKE com prefixo de % em ambos os lados pra match parcial em
  // qualquer posicao. Performance: indices em (organization_id, name)
  // ja existem; queries pequenas com LIMIT 50 sao OK.
  const pattern = `%${trimmed.replace(/[%_]/g, "\\$&")}%`;

  // Embed do pipeline/stage atual do lead pra UI mostrar contexto.
  // Se o lead nao tiver pipeline_id, vem null e UI mostra "Sem funil".
  const { data, error } = await supabase
    .from("leads")
    .select(
      `id, name, phone, email, pipeline_id, stage_id,
       pipeline:pipelines(id, name),
       stage:pipeline_stages(id, name)`,
    )
    .eq("organization_id", orgId)
    .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`)
    .order("updated_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Erro ao buscar leads: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const pipeline = row.pipeline as { id: string; name: string } | null;
    const stage = row.stage as { id: string; name: string } | null;
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      current_pipeline_id: pipeline?.id ?? null,
      current_pipeline_name: pipeline?.name ?? null,
      current_stage_id: stage?.id ?? null,
      current_stage_name: stage?.name ?? null,
    };
  });
}

// ============================================================
// Bulks
// ============================================================

export async function bulkMoveLeads(
  leadIds: string[],
  stageId: string,
): Promise<ActionResult<{ updated_count: number }>> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    const result = await bulkMoveLeadsShared(
      { db: supabase, orgId },
      leadIds,
      stageId,
    );
    revalidatePath("/crm");
    return { data: result };
  } catch (err) {
    return { error: asErrorMessage(err) };
  }
}

export async function bulkMarkLeadsAsWon(
  leadIds: string[],
): Promise<ActionResult<{ updated_count: number }>> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    const result = await bulkMarkLeadsAsWonShared(
      { db: supabase, orgId },
      leadIds,
    );
    revalidatePath("/crm");
    return { data: result };
  } catch (err) {
    return { error: asErrorMessage(err) };
  }
}

export async function bulkMarkLeadsAsLost(
  leadIds: string[],
  input: MarkLeadAsLostInput,
): Promise<ActionResult<{ updated_count: number }>> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    const result = await bulkMarkLeadsAsLostShared(
      { db: supabase, orgId },
      leadIds,
      input,
    );
    revalidatePath("/crm");
    return { data: result };
  } catch (err) {
    return { error: asErrorMessage(err) };
  }
}

// ============================================================
// Drawer "Mudar etapa" / "Mudar funil" — read queries
// ============================================================

export async function getLeadStageContext(leadId: string) {
  const { supabase, orgId } = await requireRole("agent");
  return findLeadStageContextShared({ db: supabase, orgId }, leadId);
}

export async function listPipelinesForLead(): Promise<
  Array<{ id: string; name: string }>
> {
  const { supabase, orgId } = await requireRole("agent");
  const pipelines = await listPipelinesShared({ db: supabase, orgId });
  return pipelines.map((p) => ({ id: p.id, name: p.name }));
}

export async function listStagesForPipeline(pipelineId: string) {
  const { supabase, orgId } = await requireRole("agent");
  const stages = await listStagesShared({ db: supabase, orgId }, pipelineId);
  return stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color ?? "#3b82f6",
    outcome: (s.outcome ?? "em_andamento") as
      | "em_andamento"
      | "falha"
      | "bem_sucedido",
    sort_order: s.sort_order ?? 0,
  }));
}

// ============================================================
// Deal CRUD (subentidade do lead — drawer tab "Negocios")
// ============================================================

export async function createDealForLead(input: {
  leadId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  value?: number;
}): Promise<{ id: string }> {
  const { supabase, orgId } = await requireRole("agent");
  const deal = await createDealShared(
    { db: supabase, orgId },
    {
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      title: input.title,
      value: input.value ?? 0,
      leadId: input.leadId,
    },
  );
  revalidatePath("/crm");
  return { id: deal.id };
}

export async function updateDealMeta(
  dealId: string,
  data: { title?: string; value?: number },
): Promise<ActionResult<void>> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    await updateDealShared({ db: supabase, orgId }, dealId, data);
    revalidatePath("/crm");
    return { data: undefined };
  } catch (err) {
    return { error: sanitizeMutationError(asErrorMessage(err)).message };
  }
}

export async function deleteDealForLead(
  dealId: string,
): Promise<ActionResult<void>> {
  try {
    const { supabase, orgId } = await requireRole("agent");
    await deleteDealShared({ db: supabase, orgId }, dealId);
    revalidatePath("/crm");
    return { data: undefined };
  } catch (err) {
    return { error: sanitizeMutationError(asErrorMessage(err)).message };
  }
}
