/**
 * Core deal movement logic — single source of truth.
 *
 * Used by:
 *   - CRM manual (updateDealStage server action)
 *   - API automation (/api/crm move_deal)
 *
 * Responsibilities:
 *   1. Validate stage belongs to org
 *   2. Idempotency — noop if already at target stage
 *   3. Update deal.stage_id
 *   4. Log activity in lead_activities
 *   5. Trigger onStageChanged flows
 *   6. Sync lead to UAZAPI
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface MoveDealParams {
  dealId: string;
  stageId: string;
  orgId: string;
  /** Who triggered the move */
  source: "manual" | "automation";
  /** Optional reason for the move (logged in activity) */
  reason?: string;
  /** Supabase client to use — if not provided, creates service_role client */
  supabase?: SupabaseClient;
}

export interface MoveDealResult {
  ok: boolean;
  noop?: boolean;
  error?: string;
  fromStage?: string;
  toStage?: string;
}

export async function moveDealToStage(params: MoveDealParams): Promise<MoveDealResult> {
  const { dealId, stageId, orgId, source, reason } = params;
  const supabase = params.supabase ?? getServiceClient();

  // 1. Get current deal with stage info
  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select("id, stage_id, lead_id, organization_id, pipeline_id")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal) {
    return { ok: false, error: "Deal não encontrado" };
  }

  // Validate deal belongs to org
  if (deal.organization_id !== orgId) {
    return { ok: false, error: "Deal não pertence à organização" };
  }

  // 2. Idempotency — if already at target stage, noop
  if (deal.stage_id === stageId) {
    return { ok: true, noop: true };
  }

  // 3. Validate target stage exists and belongs to a pipeline of this org
  const { data: targetStage, error: stageErr } = await supabase
    .from("pipeline_stages")
    .select("id, name, pipeline_id, organization_id")
    .eq("id", stageId)
    .single();

  if (stageErr || !targetStage) {
    return { ok: false, error: "Etapa de destino não encontrada" };
  }

  if (targetStage.organization_id !== orgId) {
    return { ok: false, error: "Etapa não pertence à organização" };
  }

  // 4. Get from-stage name for activity log
  let fromStageName = "";
  if (deal.stage_id) {
    const { data: fromStage } = await supabase
      .from("pipeline_stages")
      .select("name")
      .eq("id", deal.stage_id)
      .single();
    fromStageName = fromStage?.name || "";
  }

  // 5. Update deal
  const { error: updateErr } = await supabase
    .from("deals")
    .update({ stage_id: stageId, updated_at: new Date().toISOString() })
    .eq("id", dealId);

  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }

  // 6. Log activity (fire and forget)
  if (deal.lead_id) {
    const description = source === "automation"
      ? `IA moveu de "${fromStageName}" para "${targetStage.name}"${reason ? ` — ${reason}` : ""}`
      : `Movido de "${fromStageName}" para "${targetStage.name}"`;

    supabase.from("lead_activities").insert({
      lead_id: deal.lead_id,
      organization_id: orgId,
      type: "stage_change",
      description,
      metadata: {
        source,
        from_stage: fromStageName,
        from_stage_id: deal.stage_id,
        to_stage: targetStage.name,
        to_stage_id: stageId,
        deal_id: dealId,
        ...(reason ? { reason } : {}),
      },
    }).then(({ error }) => {
      if (error) console.error("[MoveDeal] Activity log error:", error.message);
    });
  }

  // 7. Trigger onStageChanged flows (fire and forget)
  if (deal.lead_id) {
    import("@/lib/flows/triggers").then(({ onStageChanged }) => {
      onStageChanged(orgId, deal.lead_id!, stageId);
    }).catch((e: unknown) => {
      console.error("[MoveDeal] onStageChanged error:", e);
    });
  }

  // 8. Sync lead to UAZAPI (fire and forget)
  if (deal.lead_id) {
    import("@/lib/whatsapp/sync").then(({ syncLeadToUazapi }) => {
      syncLeadToUazapi(orgId, deal.lead_id!);
    }).catch((e: unknown) => {
      console.error("[MoveDeal] sync error:", e);
    });
  }

  return {
    ok: true,
    fromStage: fromStageName,
    toStage: targetStage.name,
  };
}
