"use server";

/**
 * DEPRECATED: This file is a compatibility shim.
 * All pipeline/deal functions are now in crm.ts (which delegates to
 * @persia/shared/crm). New code should import from "@/actions/crm"
 * directly.
 */
export {
  getPipelines,
  createPipeline,
  createDeal,
  moveDeal,
  updateDealStatus,
  deleteDeal,
} from "@/actions/crm";

// `createStage` versao com argumentos posicionais (legado de
// componentes do kanban-board que chamavam dessa forma). Wrappers
// agora delegam pra @persia/shared/crm.
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createStage as createStageShared } from "@persia/shared/crm";

export async function createStage(pipelineId: string, name: string, sortOrder: number) {
  const { supabase, orgId } = await requireRole("admin");
  const stage = await createStageShared(
    { db: supabase, orgId },
    { pipelineId, name, sortOrder },
  );
  revalidatePath("/crm");
  return stage;
}
