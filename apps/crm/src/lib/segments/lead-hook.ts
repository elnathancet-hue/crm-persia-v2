// Segments — wrapper que combina evaluator + trigger pra usar como
// `onLeadChanged` hook do shared/crm mutations.
//
// PR-FLOW-PIVOT PR 12 (mai/2026): chamado fire-and-forget após
// createLead/updateLead/addTag/removeTag/set_lead_custom_field.
// Avalia segmentos, INSERTs novas memberships, dispara flows.

import { createClient } from "@supabase/supabase-js";
import { errorMessage, logError } from "@/lib/observability";
import { triggerAgentFlowsForSegmentEntry } from "@/lib/ai-agent/flow/triggers";
import type { AgentDb } from "@/lib/ai-agent/db";
import { evaluateLeadSegmentMembership } from "./evaluator";

// Service-role client interno — segments + memberships têm RLS, mas
// pra side-effect (evaluator hook) usamos service_role pra evitar
// dependência do user session do server action chamador.
function getSegmentEvaluatorClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Roda o pipeline completo: evaluator → trigger flows. Versão "low-level"
 * que aceita o db do caller (útil pra tests ou pra preservar contexto
 * RLS específico).
 */
export async function onLeadSegmentMembershipMaybeChanged(
  supabaseOrAgentDb: AgentDb | { from: (table: string) => unknown },
  orgId: string,
  leadId: string,
): Promise<void> {
  try {
    const newlyAdded = await evaluateLeadSegmentMembership(
      supabaseOrAgentDb,
      orgId,
      leadId,
    );
    if (newlyAdded.length === 0) return;

    await Promise.all(
      newlyAdded.map((segmentId) =>
        triggerAgentFlowsForSegmentEntry(
          supabaseOrAgentDb,
          orgId,
          leadId,
          segmentId,
        ).catch((err) => {
          logError("segment_lead_hook_trigger_failed", {
            organization_id: orgId,
            lead_id: leadId,
            segment_id: segmentId,
            error: errorMessage(err),
          });
        }),
      ),
    );
  } catch (err) {
    logError("segment_lead_hook_failed", {
      organization_id: orgId,
      lead_id: leadId,
      error: errorMessage(err),
    });
  }
}

/**
 * Fire-and-forget wrapper que internamente cria service-role client +
 * roda o pipeline. Usado por `makeOnLeadChanged` em server actions
 * que não querem propagar o client deles. NÃO retorna promise útil —
 * caller envolve em `void`.
 */
export function dispatchSegmentMembershipHook(
  orgId: string,
  leadId: string,
): void {
  void (async () => {
    try {
      const sb = getSegmentEvaluatorClient();
      await onLeadSegmentMembershipMaybeChanged(sb, orgId, leadId);
    } catch (err) {
      logError("dispatch_segment_membership_hook_failed", {
        organization_id: orgId,
        lead_id: leadId,
        error: errorMessage(err),
      });
    }
  })();
}
