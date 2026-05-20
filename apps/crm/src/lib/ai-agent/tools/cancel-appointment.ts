import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { cancelAppointment as cancelSharedAppointment } from "@persia/shared/agenda";
import { notifyLeadAppointmentCancelled } from "@/lib/agenda/notifications/dispatch";
import { errorMessage, logError } from "@/lib/observability";
import {
  deleteGoogleEvent,
  loadGoogleConnectionForOrg,
} from "@/lib/google-calendar/events";
import { failureResult, getHandlerDb, successResult, trimReason } from "./shared";

// PR-AGENDA-TOOLS (mai/2026): AI cancela appointment quando lead pede
// no chat ("cancelar", "nao vou poder", etc). Reusa `cancelAppointment`
// shared + dispara notificacao WhatsApp via PR #220.
//
// Defesas:
//   - Confirma appointment pertence ao lead da conversa (sem cross-lead)
//   - Confirma appointment pertence ao org (multi-tenant)
//   - cancelled_by_role = 'agent' (AI agindo em nome do agente)

const cancelSchema = z.object({
  appointment_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
});

interface AppointmentRow {
  id: string;
  lead_id: string | null;
  status: string;
  google_event_id: string | null;
}

export const cancelAppointmentHandler: NativeHandler = async (context, input) => {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const reason = trimReason(parsed.data.reason, "cancelado pelo agente IA");

  // 1. Confirma appointment existe + pertence ao org + ao lead da conversa.
  const { data: apptRow, error: apptError } = await db
    .from("appointments")
    .select("id, lead_id, status, google_event_id")
    .eq("organization_id", context.organization_id)
    .eq("id", parsed.data.appointment_id)
    .maybeSingle();

  if (apptError) return failureResult(apptError.message);
  if (!apptRow) return failureResult("agendamento nao encontrado nesta organizacao");

  const appt = apptRow as AppointmentRow;
  if (appt.lead_id !== context.lead_id) {
    return failureResult("agendamento nao pertence a este lead");
  }
  if (appt.status === "cancelled") {
    return successResult(
      {
        appointment_id: appt.id,
        noop: true,
        reason,
      },
      [`appointment ${appt.id} already cancelled — noop`],
    );
  }

  if (context.dry_run) {
    return successResult(
      {
        appointment_id: appt.id,
        reason,
        dry_run: true,
        noop: false,
      },
      [`would cancel appointment ${appt.id} with reason "${reason}"`],
    );
  }

  // 2. Cancela via shared mutation.
  try {
    const cancelled = await cancelSharedAppointment(
      {
        db,
        orgId: context.organization_id,
        userId: null,
        performedByRole: "agent",
      },
      appt.id,
      {
        reason,
        cancelled_by_role: "agent",
      },
    );

    // 3. Notifica lead via WhatsApp (PR #220). Fire-and-forget — falha
    //    na notificacao NAO desfaz o cancelamento no DB.
    void notifyLeadAppointmentCancelled(cancelled, reason).catch((err) => {
      console.error("[cancel-appointment tool] notify failed:", err);
    });

    // 4. PR-FLOW-PIVOT PR 14b (mai/2026): se appointment tinha event no
    //    Google Calendar, deleta lá também. Best-effort.
    let googleEventDeleted = false;
    if (appt.google_event_id) {
      try {
        const conn = await loadGoogleConnectionForOrg(db, context.organization_id);
        if (conn) {
          await deleteGoogleEvent(
            db,
            conn,
            conn.default_calendar_id,
            appt.google_event_id,
          );
          googleEventDeleted = true;
        }
      } catch (gcalErr) {
        logError("cancel_appointment_gcal_delete_failed", {
          organization_id: context.organization_id,
          appointment_id: appt.id,
          google_event_id: appt.google_event_id,
          error: errorMessage(gcalErr),
        });
      }
    }

    return successResult(
      {
        appointment_id: cancelled.id,
        status: cancelled.status,
        cancelled_at: cancelled.cancelled_at,
        cancelled_by_role: cancelled.cancelled_by_role,
        cancellation_reason: cancelled.cancellation_reason,
        noop: false,
        google_event_deleted: googleEventDeleted,
      },
      [
        `cancelled appointment ${cancelled.id} — lead notified via WhatsApp`,
        ...(googleEventDeleted ? ["deleted from Google Calendar"] : []),
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "falha ao cancelar agendamento";
    return failureResult(msg);
  }
};
