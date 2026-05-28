import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { moveLeadToStage as moveLeadToStageShared } from "@persia/shared/crm";
import { onStageChanged } from "@/lib/flows/triggers";
import { triggerAgentFlowsForStageEntry } from "../flow/triggers";
import {
  failureResult,
  getHandlerDb,
  insertLeadActivity,
  successResult,
  trimReason,
} from "./shared";

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
//
// PR-AI-AGENT-TOOLS-NAMES (mai/2026): aceita `stage_name` (nome amigavel
// vindo do catalogo no system prompt) OU `stage_id` (UUID — retrocompat).
// Pelo menos um e obrigatorio. Validacao no codigo, nao no zod (precisa
// de refinement custom — preferimos mensagem clara).
const moveStageSchema = z.object({
  stage_name: z.string().trim().min(1).max(120).nullish(),
  stage_id: z.string().uuid().nullish(),
  pipeline_id: z.string().uuid().nullish(),
  reason: z.string().trim().min(1).max(500).nullish(),
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

  // 2. Resolve a stage de destino — aceita stage_name OU stage_id.
  // Pelo menos um obrigatorio.
  if (!parsed.data.stage_name && !parsed.data.stage_id) {
    return failureResult("informe stage_name (recomendado) ou stage_id");
  }

  let targetStage: StageRow | null = null;
  if (parsed.data.stage_id) {
    const { data, error: stageError } = await db
      .from("pipeline_stages")
      .select("id, name, pipeline_id, organization_id")
      .eq("id", parsed.data.stage_id)
      .maybeSingle();
    if (stageError) return failureResult(stageError.message);
    targetStage = (data as StageRow | null) ?? null;
  } else if (parsed.data.stage_name) {
    // Lookup por nome dentro do funil do lead (case-insensitive).
    // Restringe ao mesmo pipeline pra evitar match com etapa de outro
    // funil quando ha nomes repetidos entre funis (comum: "Novo",
    // "Qualificado").
    const { data, error: stageError } = await db
      .from("pipeline_stages")
      .select("id, name, pipeline_id, organization_id")
      .eq("organization_id", context.organization_id)
      .eq("pipeline_id", lead.pipeline_id)
      .ilike("name", parsed.data.stage_name)
      .limit(1)
      .maybeSingle();
    if (stageError) return failureResult(stageError.message);
    targetStage = (data as StageRow | null) ?? null;
  }

  if (!targetStage) {
    return failureResult("etapa de destino nao encontrada", {
      requested: parsed.data.stage_name ?? parsed.data.stage_id,
      hint: "use o nome EXATO da lista de etapas no contexto",
    });
  }

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

  // 6. Side effects: onStageChanged (legacy flows) + sync UAZAPI +
  // triggerAgentFlowsForStageEntry (PR 11 — agent_flows v2). Todos
  // fire-and-forget pra não bloquear o resultado do tool call.
  void onStageChanged(context.organization_id, lead.id, stage.id).catch((err) => {
    console.error("[move-pipeline-stage] onStageChanged failed:", err);
  });

  // PR-FLOW-PIVOT PR 11 (mai/2026): hook do agent_flows v2 — dispara
  // flows com entry pipeline_stage_entered casando com stage.id.
  void triggerAgentFlowsForStageEntry(
    db,
    context.organization_id,
    lead.id,
    stage.id,
  ).catch((err) => {
    console.error(
      "[move-pipeline-stage] triggerAgentFlowsForStageEntry failed:",
      err,
    );
  });

  // syncLeadToUazapi assincrono (modulo dinamico pra nao puxar pra bundle)
  void import("@/lib/whatsapp/sync")
    .then(({ syncLeadToUazapi }) => syncLeadToUazapi(context.organization_id, lead.id))
    .catch((err) => {
      console.error("[move-pipeline-stage] syncLeadToUazapi failed:", err);
    });

  // PR-AGENT-INTEGRATION-1: log no historico do lead.
  await insertLeadActivity({
    db,
    organizationId: context.organization_id,
    leadId: lead.id,
    type: "stage_changed",
    description: `IA moveu o lead de "${fromStageName}" para "${stage.name}"`,
    metadata: {
      from_stage_id: lead.stage_id,
      from_stage_name: fromStageName,
      to_stage_id: stage.id,
      to_stage_name: stage.name,
      pipeline_id: lead.pipeline_id,
      reason: reason ?? null,
    },
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
