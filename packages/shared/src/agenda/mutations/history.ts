// appointment_history — helper de insert.
//
// Toda mutation que altera appointment chama insertHistory pra registrar
// a mudanca. Nao bloqueia se falhar — loga e segue (history eh
// nice-to-have, nao deve quebrar a action principal).

import type {
  AppointmentHistoryAction,
  HistoryPerformedByRole,
} from "../types";
import type { AgendaMutationContext } from "../queries/context";

export interface InsertHistoryArgs {
  appointment_id: string;
  action: AppointmentHistoryAction;
  metadata?: Record<string, unknown>;
}

export async function insertHistory(
  ctx: AgendaMutationContext,
  args: InsertHistoryArgs,
): Promise<void> {
  const { db, orgId, userId, performedByRole = "agent" } = ctx;
  const role: HistoryPerformedByRole = performedByRole;

  const { error } = await db.from("appointment_history").insert({
    appointment_id: args.appointment_id,
    organization_id: orgId,
    action: args.action,
    metadata: args.metadata ?? {},
    performed_by_user_id: userId,
    performed_by_role: role,
  });

  if (error) {
    // History eh best-effort. Log e segue.
    console.error("[agenda.history] insert falhou:", error.message, args);
  }
}
