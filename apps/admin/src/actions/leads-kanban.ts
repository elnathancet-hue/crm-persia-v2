"use server";

// Admin actions lead-centric do Kanban — espelho do CRM (apps/crm/src/actions/leads-kanban.ts)
// mas com auth admin via requireSuperadminForOrg (service-role bypassa RLS).
//
// PR-K-CENTRIC cleanup (mai/2026): Admin agora usa as MESMAS funcoes
// shared @persia/shared/crm/mutations/leads-kanban do CRM. Antes da
// limpeza, o admin tinha so o legacy `getLeadOpenDealWithStages` +
// `updateDealStage` (que mexiam direto em `deals.stage_id`). Agora
// move via `leads.stage_id` — coerente com o source-of-truth pos-refactor.

import { revalidatePath } from "next/cache";
import { requireSuperadminForOrg } from "@/lib/auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findLeadStageContext as findLeadStageContextShared,
  listPipelines as listPipelinesShared,
  listStages as listStagesShared,
  moveLeadToPipeline as moveLeadToPipelineShared,
  moveLeadToStage as moveLeadToStageShared,
} from "@persia/shared/crm";

export async function moveLeadStage(
  leadId: string,
  stageId: string,
  sortOrder: number,
): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const db = admin as unknown as SupabaseClient;
  await moveLeadToStageShared({ db, orgId }, leadId, stageId, sortOrder);
  revalidatePath("/crm");
}

export async function moveLeadToPipeline(
  leadId: string,
  pipelineId: string,
  stageId: string,
): Promise<void> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const db = admin as unknown as SupabaseClient;
  await moveLeadToPipelineShared({ db, orgId }, leadId, pipelineId, stageId);
  revalidatePath("/crm");
}

export async function getLeadStageContext(leadId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const db = admin as unknown as SupabaseClient;
  return findLeadStageContextShared({ db, orgId }, leadId);
}

export async function listPipelinesForLead(): Promise<
  Array<{ id: string; name: string }>
> {
  const { admin, orgId } = await requireSuperadminForOrg();
  const db = admin as unknown as SupabaseClient;
  const pipelines = await listPipelinesShared({ db, orgId });
  return pipelines.map((p) => ({ id: p.id, name: p.name }));
}

export async function listStagesForPipeline(pipelineId: string) {
  const { admin, orgId } = await requireSuperadminForOrg();
  const db = admin as unknown as SupabaseClient;
  const stages = await listStagesShared({ db, orgId }, pipelineId);
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
