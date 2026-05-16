import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { moveLeadToStage as moveLeadToStageShared } from "@persia/shared/crm";
import { onStageChanged } from "@/lib/flows/triggers";
import { failureResult, getHandlerDb, successResult, trimReason } from "./shared";

// PR-K-CENTRIC (mai/2026): move o LEAD (nao o deal) para outra etapa do
// funil em que ele esta. Lead aparece 1x no Kanban; deals viram historico
// dentro do drawer.
//
// Diferenca pra `transfer_to_stage` (que move entre etapas DO AGENTE):
// este handler mexe no Kanban do CRM (pipeline_stages), nao no fluxo
// interno do agente.
//
// Simplificacao pos-refactor: nao precisa mais buscar deal aberto.
//   - 1 query menos por chamada (vs 2 antes)
//   - Sem ambiguidade multi-deal — lead esta em 1 funil so
//
// Edge cases:
//   - Lead sem pipeline atribuido -> error "lead nao esta em nenhum funil"
//   - pipeline_id informado mas diferente -> error
//   - Stage de outro funil         -> error (validado abaixo)
//   - Idempotencia (mesma stage)   -> retorna sucesso com noop=true
const moveStageSchema = z.object({
  stage_id: z.string().uuid(),
  pipeline_id: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

interface LeadRow {
  id: string;
  pipeline_id: string | null;
  stage_id: string | null;
}

interface StageRow {
  id: string;
  name: string;
  pipeline_id: string;
  organization_id: string;
}

export const movePipelineStageHandler: NativeHandler = async (context, input) => {
  const parsed = moveStageSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const reason = trimReason(parsed.data.reason, "agent_requested_kanban_move");

  // 1. Busca o lead direto (pipeline/stage atuais).
  const { data: leadRow, error: leadError } = await db
    .from("leads")
    .select("id, pipeline_id, stage_id")
    .eq("organization_id", context.organization_id)
    .eq("id", context.lead_id)
    .maybeSingle();

  if (leadError) return failureResult(leadError.message);
  if (!leadRow) return failureResult("lead nao encontrado");

  const lead = leadRow as LeadRow;

  if (!lead.pipeline_id || !lead.stage_id) {
    return failureResult("lead nao esta em nenhum funil");
  }

  if (parsed.data.pipeline_id && lead.pipeline_id !== parsed.data.pipeline_id) {
    return failureResult(
      "lead esta em outro funil — informe pipeline_id correto ou use moveLeadToPipeline pra trocar",
      { current_pipeline_id: lead.pipeline_id },
    );
  }

  // 2. Valida stage de destino: existe + pertence ao org + pertence ao mesmo
  //    funil do lead.
  const { data: targetStage, error: stageError } = await db
    .from("pipeline_stages")
    .select("id, name, pipeline_id, organization_id")
    .eq("id", parsed.data.stage_id)
    .maybeSingle();

  if (stageError) return failureResult(stageError.message);
  if (!targetStage) return failureResult("etapa de destino nao encontrada");

  const stage = targetStage as StageRow;
  if (stage.organization_id !== context.organization_id) {
    return failureResult("etapa nao pertence a esta organizacao");
  }
  if (stage.pipeline_id !== lead.pipeline_id) {
    return failureResult("etapa nao pertence ao funil do lead");
  }

  // 3. Idempotencia — ja esta na stage de destino.
  if (lead.stage_id === stage.id) {
    return successResult(
      {
        lead_id: lead.id,
        stage_id: stage.id,
        stage_name: stage.name,
        pipeline_id: lead.pipeline_id,
        noop: true,
        reason,
      },
      [`lead ja esta na etapa "${stage.name}" — nada a fazer`],
    );
  }

  // 4. Pega nome da stage atual (pra audit trail).
  const { data: fromStageRow } = await db
    .from("pipeline_stages")
    .select("name")
    .eq("id", lead.stage_id)
    .maybeSingle();
  const fromStageName =
    typeof fromStageRow?.name === "string" ? fromStageRow.name : "";

  if (context.dry_run) {
    return successResult(
      {
        lead_id: lead.id,
        from_stage_id: lead.stage_id,
        from_stage_name: fromStageName,
        to_stage_id: stage.id,
        to_stage_name: stage.name,
        pipeline_id: lead.pipeline_id,
        reason,
      },
      [
        `would move lead from "${fromStageName || lead.stage_id}" to "${stage.name}" in CRM Kanban`,
      ],
    );
  }

  // 5. Real run — chama shared `moveLeadToStage` (activity log automatico).
  //    Em seguida dispara onStageChanged flows e syncLeadToUazapi
  //    (paridade com o caminho manual de moveDealToStage legado).
  try {
    await moveLeadToStageShared(
      { db, orgId: context.organization_id },
      lead.id,
      stage.id,
      0, // sortOrder=0 — AI move pro topo da coluna
    );
  } catch (err) {
    return failureResult(
      err instanceof Error ? err.message : "falha ao mover lead",
    );
  }

  // 6. Side effects: onStageChanged + sync UAZAPI (fire-and-forget).
  void onStageChanged(context.organization_id, lead.id, stage.id).catch((err) => {
    console.error("[move-pipeline-stage] onStageChanged failed:", err);
  });

  // syncLeadToUazapi assincrono (modulo dinamico pra nao puxar pra bundle)
  void import("@/lib/whatsapp/sync")
    .then(({ syncLeadToUazapi }) => syncLeadToUazapi(context.organization_id, lead.id))
    .catch((err) => {
      console.error("[move-pipeline-stage] syncLeadToUazapi failed:", err);
    });

  return successResult(
    {
      lead_id: lead.id,
      from_stage_id: lead.stage_id,
      from_stage_name: fromStageName,
      to_stage_id: stage.id,
      to_stage_name: stage.name,
      pipeline_id: lead.pipeline_id,
      noop: false,
      reason,
    },
    [
      `moved lead from "${fromStageName}" to "${stage.name}" in CRM Kanban`,
    ],
  );
};
