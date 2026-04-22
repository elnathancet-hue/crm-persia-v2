"use server";

/**
 * DEPRECATED: This file is a compatibility shim.
 * All pipeline/deal functions are now in crm.ts.
 * New code should import from "@/actions/crm" directly.
 */
export {
  getPipelines,
  createPipeline,
  createDeal,
  moveDeal,
  updateDealStatus,
  deleteDeal,
} from "@/actions/crm";

// createStage signature differed (positional args vs FormData).
// Re-export the FormData version from crm.ts. If kanban needs positional args,
// wrap it here:
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function createStage(pipelineId: string, name: string, sortOrder: number) {
  const { supabase, orgId } = await requireRole("admin");

  // Guard: the supplied pipelineId must belong to the caller's org.
  // Without this, an admin with a foreign pipeline UUID could create a
  // stage row with organization_id=caller and pipeline_id=<foreign>,
  // polluting the foreign pipeline's stage view.
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!pipeline) {
    throw new Error("Pipeline nao encontrado nesta organizacao");
  }

  const { data } = await supabase
    .from("pipeline_stages")
    .insert({ pipeline_id: pipelineId, organization_id: orgId, name, sort_order: sortOrder })
    .select()
    .single();
  revalidatePath("/crm");
  return data;
}
