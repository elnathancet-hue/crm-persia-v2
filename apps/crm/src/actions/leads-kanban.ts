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
  createLead as createLeadShared,
  moveLeadToPipeline as moveLeadToPipelineShared,
  moveLeadToStage as moveLeadToStageShared,
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
