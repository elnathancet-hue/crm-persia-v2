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
  const { data } = await supabase
    .from("pipeline_stages")
    .insert({ pipeline_id: pipelineId, organization_id: orgId, name, sort_order: sortOrder })
    .select()
    .single();
  revalidatePath("/crm");
  return data;
}
