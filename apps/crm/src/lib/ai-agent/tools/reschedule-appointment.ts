import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { rescheduleAppointment as rescheduleSharedAppointment } from "@persia/shared/agenda";
import { notifyLeadAppointmentRescheduled } from "@/lib/agenda/notifications/dispatch";
import { failureResult, getHandlerDb, successResult } from "./shared";

// PR-AGENDA-TOOLS (mai/2026): AI reagenda appointment quando lead pede
// outro horario via chat. Cria replacement (status awaiting_confirmation)
// + marca original como 'rescheduled'. Notifica lead via WhatsApp.
//
// Defesas:
//   - Confirma appointment existe + pertence ao org + ao lead da conversa
//   - new_start_at no futuro
//   - new_duration_minutes opcional (default = duration_minutes do original)
//   - Conflict check pelo shared (rejeita slots sobrepostos)

const rescheduleSchema = z.object({
  appointment_id: z.string().uuid(),
  new_start_at: z.string().datetime({ offset: true }),
  new_duration_minutes: z.number().int().min(15).max(480).optional(),
});

interface AppointmentRow {
  id: string;
  lead_id: string | null;
  duration_minutes: number;
  status: string;
}

export const rescheduleAppointmentHandler: NativeHandler = async (
  context,
  input,
) => {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  const startMs = Date.parse(parsed.data.new_start_at);
  if (Number.isNaN(startMs)) {
    return failureResult("new_start_at invalido");
  }
  if (startMs <= Date.now()) {
    return failureResult("new_start_at deve ser no futuro");
  }

  // 1. Confirma appointment existe + pertence ao org + ao lead.
  const { data: apptRow, error: apptError } = await db
    .from("appointments")
    .select("id, lead_id, duration_minutes, status")
    .eq("organization_id", context.organization_id)
    .eq("id", parsed.data.appointment_id)
    .maybeSingle();

  if (apptError) return failureResult(apptError.message);
  if (!apptRow) return failureResult("agendamento nao encontrado nesta organizacao");

  const appt = apptRow as AppointmentRow;
  if (appt.lead_id !== context.lead_id) {
    return failureResult("agendamento nao pertence a este lead");
  }

  const newDuration =
    parsed.data.new_duration_minutes ?? appt.duration_minutes;
  const endMs = startMs + newDuration * 60_000;
  const new_end_at = new Date(endMs).toISOString();

  if (context.dry_run) {
    return successResult(
      {
        appointment_id: appt.id,
        new_start_at: parsed.data.new_start_at,
        new_end_at,
        new_duration_minutes: newDuration,
        dry_run: true,
      },
      [
        `would reschedule appointment ${appt.id} to ${parsed.data.new_start_at}`,
      ],
    );
  }

  // 2. Reagenda via shared (cria replacement + marca original como
  //    'rescheduled' atomicamente).
  try {
    const result = await rescheduleSharedAppointment(
      {
        db,
        orgId: context.organization_id,
        userId: null,
        performedByRole: "agent",
      },
      appt.id,
      {
        new_start_at: parsed.data.new_start_at,
        new_end_at,
      },
    );

    // 3. Notifica lead via WhatsApp (PR #220). Fire-and-forget.
    void notifyLeadAppointmentRescheduled(
      result.original,
      result.replacement,
    ).catch((err) => {
      console.error("[reschedule-appointment tool] notify failed:", err);
    });

    return successResult(
      {
        original_id: result.original.id,
        replacement_id: result.replacement.id,
        new_start_at: result.replacement.start_at,
        new_end_at: result.replacement.end_at,
        new_duration_minutes: result.replacement.duration_minutes,
        status: result.replacement.status,
      },
      [
        `rescheduled appointment ${result.original.id} → ${result.replacement.id} at ${result.replacement.start_at}; lead notified via WhatsApp`,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "falha ao reagendar agendamento";
    return failureResult(msg);
  }
};
