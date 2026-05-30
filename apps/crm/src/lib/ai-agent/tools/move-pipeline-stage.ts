import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import {
  moveLeadToPipeline as moveLeadToPipelineShared,
  moveLeadToStage as moveLeadToStageShared,
} from "@persia/shared/crm";
import { onStageChanged } from "@/lib/flows/triggers";
import { triggerAgentFlowsForStageEntry } from "../flow/triggers";
import {
  failureResult,
  getHandlerDb,
  insertLeadActivity,
  successResult,
  trimReason,
} from "./shared";

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
  // Sanitize: node.data.config usa "" como default (não null/undefined),
  // mas Zod rejeita "" em campos uuid/min(1). Converte strings vazias
  // pra undefined antes de validar.
  const raw = input as Record<string, unknown>;
  const sanitized = {
    stage_name: raw.stage_name || undefined,
    stage_id: raw.stage_id || undefined,
    pipeline_id: raw.pipeline_id || undefined,
    reason: raw.reason || undefined,
  };
  const parsed = moveStageSchema.safeParse(sanitized);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const reason = trimReason(parsed.data.reason, "agent_requested_kanban_move");

  const { data: leadRow, error: leadError } = await db
    .from("leads")
    .select("id, pipeline_id, stage_id")
    .eq("organization_id", context.organization_id)
    .eq("id", context.lead_id)
    .maybeSingle();

  if (leadError) return failureResult(leadError.message);
  if (!leadRow) return failureResult("lead nao encontrado");

  const lead = leadRow as LeadRow;

  if (!parsed.data.stage_name && !parsed.data.stage_id) {
    return failureResult("informe stage_name (recomendado) ou stage_id");
  }

  let targetStage: StageRow | null = null;

  if (parsed.data.stage_id) {
    const { data, error: stageError } = await db
      .from("pipeline_stages")
      .select("id, name, pipeline_id, organization_id")
      .eq("id", parsed.data.stage_id)
      .eq("organization_id", context.organization_id)
      .maybeSingle();
    if (stageError) return failureResult(stageError.message);
    targetStage = (data as StageRow | null) ?? null;
  } else if (parsed.data.stage_name) {
    const lookupPipelineId = parsed.data.pipeline_id ?? lead.pipeline_id;
    if (!lookupPipelineId) {
      return failureResult(
        "lead nao esta em nenhum funil; informe stage_id ou pipeline_id",
      );
    }

    const { data, error: stageError } = await db
      .from("pipeline_stages")
      .select("id, name, pipeline_id, organization_id")
      .eq("organization_id", context.organization_id)
      .eq("pipeline_id", lookupPipelineId)
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

  const stage = targetStage;
  if (stage.organization_id !== context.organization_id) {
    return failureResult("etapa nao pertence a esta organizacao");
  }
  if (parsed.data.pipeline_id && stage.pipeline_id !== parsed.data.pipeline_id) {
    return failureResult("etapa nao pertence ao funil informado", {
      requested_pipeline_id: parsed.data.pipeline_id,
      stage_pipeline_id: stage.pipeline_id,
    });
  }

  if (lead.stage_id === stage.id) {
    return successResult(
      {
        lead_id: lead.id,
        stage_id: stage.id,
        stage_name: stage.name,
        pipeline_id: stage.pipeline_id,
        noop: true,
        reason,
      },
      [`lead ja esta na etapa "${stage.name}" - nada a fazer`],
    );
  }

  const { data: fromStageRow } = lead.stage_id
    ? await db.from("pipeline_stages").select("name").eq("id", lead.stage_id).maybeSingle()
    : { data: null };
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
        from_pipeline_id: lead.pipeline_id,
        to_pipeline_id: stage.pipeline_id,
        reason,
      },
      [
        `would move lead from "${fromStageName || lead.stage_id || "sem etapa"}" to "${stage.name}" in CRM Kanban`,
      ],
    );
  }

  try {
    if (lead.pipeline_id && lead.pipeline_id === stage.pipeline_id) {
      await moveLeadToStageShared(
        { db, orgId: context.organization_id },
        lead.id,
        stage.id,
        0,
      );
    } else {
      await moveLeadToPipelineShared(
        { db, orgId: context.organization_id },
        lead.id,
        stage.pipeline_id,
        stage.id,
      );
    }
  } catch (err) {
    return failureResult(
      err instanceof Error ? err.message : "falha ao mover lead",
    );
  }

  void onStageChanged(context.organization_id, lead.id, stage.id).catch((err) => {
    console.error("[move-pipeline-stage] onStageChanged failed:", err);
  });

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

  void import("@/lib/whatsapp/sync")
    .then(({ syncLeadToUazapi }) => syncLeadToUazapi(context.organization_id, lead.id))
    .catch((err) => {
      console.error("[move-pipeline-stage] syncLeadToUazapi failed:", err);
    });

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
      from_pipeline_id: lead.pipeline_id,
      to_pipeline_id: stage.pipeline_id,
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
      from_pipeline_id: lead.pipeline_id,
      to_pipeline_id: stage.pipeline_id,
      noop: false,
      reason,
    },
    [`moved lead from "${fromStageName}" to "${stage.name}" in CRM Kanban`],
  );
};
