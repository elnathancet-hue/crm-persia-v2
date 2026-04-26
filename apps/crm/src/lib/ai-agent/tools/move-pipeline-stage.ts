import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { moveDealToStage } from "@/lib/crm/move-deal";
import { failureResult, getHandlerDb, successResult, trimReason } from "./shared";

// Move o deal ativo do lead para outra etapa do mesmo funil.
//
// Diferenca pra `transfer_to_stage` (que move entre etapas DO AGENTE):
// este handler mexe no Kanban do CRM (pipeline_stages), nao no fluxo
// interno do agente.
//
// Edge cases:
//   - Lead sem deal aberto       -> error "lead nao esta em nenhum funil"
//   - Lead em multiplos funis +
//     pipeline_id NAO informado  -> error "ambiguo, especifique pipeline_id"
//   - Stage de outro funil       -> error (validado em moveDealToStage)
//   - Idempotencia (mesma stage) -> retorna sucesso com noop=true
const moveStageSchema = z.object({
  stage_id: z.string().uuid(),
  pipeline_id: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

interface DealRow {
  id: string;
  pipeline_id: string;
  stage_id: string;
  status: string | null;
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

  // 1. Busca deals ativos do lead (status open). Se pipeline_id foi informado,
  //    filtra. Se nao, pega todos pra detectar ambiguidade.
  const dealsQuery = db
    .from("deals")
    .select("id, pipeline_id, stage_id, status")
    .eq("organization_id", context.organization_id)
    .eq("lead_id", context.lead_id)
    .eq("status", "open");

  if (parsed.data.pipeline_id) {
    dealsQuery.eq("pipeline_id", parsed.data.pipeline_id);
  }

  const { data: deals, error: dealsError } = await dealsQuery;
  if (dealsError) return failureResult(dealsError.message);

  const activeDeals = (deals ?? []) as DealRow[];

  if (activeDeals.length === 0) {
    return failureResult(
      parsed.data.pipeline_id
        ? "lead nao tem deal aberto neste funil"
        : "lead nao esta em nenhum funil aberto do CRM",
    );
  }

  if (activeDeals.length > 1) {
    return failureResult(
      "lead esta em mais de um funil aberto — informe pipeline_id pra escolher qual mover",
      { pipeline_ids: activeDeals.map((d) => d.pipeline_id) },
    );
  }

  const deal = activeDeals[0];

  // 2. Valida stage de destino: existe + pertence ao org + pertence ao mesmo
  //    funil do deal.
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
  if (stage.pipeline_id !== deal.pipeline_id) {
    return failureResult("etapa nao pertence ao funil do deal do lead");
  }

  // 3. Idempotencia — ja esta na stage de destino.
  if (deal.stage_id === stage.id) {
    return successResult(
      {
        deal_id: deal.id,
        stage_id: stage.id,
        stage_name: stage.name,
        pipeline_id: deal.pipeline_id,
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
    .eq("id", deal.stage_id)
    .maybeSingle();
  const fromStageName =
    typeof fromStageRow?.name === "string" ? fromStageRow.name : "";

  if (context.dry_run) {
    return successResult(
      {
        deal_id: deal.id,
        from_stage_id: deal.stage_id,
        from_stage_name: fromStageName,
        to_stage_id: stage.id,
        to_stage_name: stage.name,
        pipeline_id: deal.pipeline_id,
        reason,
      },
      [
        `would move lead from "${fromStageName || deal.stage_id}" to "${stage.name}" in CRM Kanban`,
      ],
    );
  }

  // 5. Real run — delega pra `moveDealToStage` que e a fonte unica de verdade
  //    pra movimentacao de deal (manual + automation). Reuso garante:
  //    - lead_activities entry com source: 'automation'
  //    - onStageChanged() flows disparados
  //    - syncLeadToUazapi() apos a mudanca
  const result = await moveDealToStage({
    dealId: deal.id,
    stageId: stage.id,
    orgId: context.organization_id,
    source: "automation",
    reason,
    supabase: db as unknown as SupabaseClient,
  });

  if (!result.ok) {
    return failureResult(result.error ?? "falha ao mover deal");
  }

  return successResult(
    {
      deal_id: deal.id,
      from_stage_id: deal.stage_id,
      from_stage_name: result.fromStage ?? fromStageName,
      to_stage_id: stage.id,
      to_stage_name: result.toStage ?? stage.name,
      pipeline_id: deal.pipeline_id,
      noop: !!result.noop,
      reason,
    },
    [
      result.noop
        ? `lead ja estava na etapa "${stage.name}" — sem alteracao`
        : `moved lead from "${result.fromStage ?? fromStageName}" to "${result.toStage ?? stage.name}" in CRM Kanban`,
    ],
  );
};
