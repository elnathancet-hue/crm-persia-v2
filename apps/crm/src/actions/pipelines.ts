"use server";

/**
 * Shim historico do refactor — antes era arquivo separado com
 * `createDeal/moveDeal/deleteDeal/updateDealStatus` re-exportados.
 * Pos PR-K-CENTRIC cleanup Fase B (mai/2026) o re-export foi removido
 * (kanban-board.tsx legacy que consumia foi deletado). Mantemos so
 * `createStage` (versao posicional) usado por testes multi-tenant.
 */

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
