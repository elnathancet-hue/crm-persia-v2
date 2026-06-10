import { z } from "zod";
import type { NativeHandler } from "@persia/shared/ai-agent";
import { notifyLeadAppointmentConfirmed } from "@/lib/agenda/notifications/dispatch";
import { errorMessage, logError } from "@/lib/observability";
import { failureResult, getHandlerDb, insertLeadActivity, successResult } from "./shared";

// Tool confirm_appointment: IA confirma um agendamento pendente quando o
// lead confirma verbalmente no chat ("pode ser", "confirmo", "sim").
//
// Sem esta tool, todos os agendamentos criados pela IA ficam eternamente
// como "awaiting_confirmation" — o operador precisaria confirmar manualmente
// cada um na agenda, mesmo quando o lead ja confirmou na conversa.
//
// Regras:
//   - Só confirma status 'awaiting_confirmation' → 'confirmed'.
//   - Verifica que o appointment pertence ao lead da conversa (anti cross-lead).
//   - Notifica lead via WhatsApp (fire-and-forget).
//   - Se ja estiver 'confirmed', retorna noop = true (idempotente).
//   - Nao cancela, nao reagenda — so muda status.

const confirmSchema = z.object({
  appointment_id: z.string().uuid(),
});

interface AppointmentRow {
  id: string;
  organization_id: string;
  lead_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  timezone: string | null;
  status: string;
  channel: string | null;
  location: string | null;
  meeting_url: string | null;
  service_id: string | null;
  user_id: string;
}

export const confirmAppointmentHandler: NativeHandler = async (context, input) => {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return failureResult("invalid tool input", {
      issues: parsed.error.issues.map((i) => i.message),
    });
  }

  const db = getHandlerDb(context);
  if (!db) return failureResult("database context missing");

  // 1. Busca e valida o appointment
  const { data: apptRow, error: apptError } = await db
    .from("appointments")
    .select(
      "id, organization_id, lead_id, title, start_at, end_at, duration_minutes, timezone, status, channel, location, meeting_url, service_id, user_id",
    )
    .eq("organization_id", context.organization_id)
    .eq("id", parsed.data.appointment_id)
    .maybeSingle();

  if (apptError) return failureResult(apptError.message);
  if (!apptRow) return failureResult("agendamento nao encontrado nesta organizacao");

  const appt = apptRow as AppointmentRow;

  // Verifica que pertence ao lead da conversa
  if (appt.lead_id !== context.lead_id) {
    return failureResult("agendamento nao pertence a este lead");
  }

  // Idempotente: ja confirmado
  if (appt.status === "confirmed") {
    return successResult(
      { appointment_id: appt.id, status: "confirmed", noop: true },
      [`appointment ${appt.id} already confirmed — noop`],
    );
  }

  // Só confirma 'awaiting_confirmation'
  if (appt.status !== "awaiting_confirmation") {
    return failureResult(
      `nao e possivel confirmar agendamento com status "${appt.status}" — apenas awaiting_confirmation pode ser confirmado`,
      { current_status: appt.status },
    );
  }

  if (context.dry_run) {
    return successResult(
      { appointment_id: appt.id, status: "confirmed", noop: false, dry_run: true },
      [`would confirm appointment ${appt.id}`],
    );
  }

  // 2. Atualiza status para confirmed
  const { error: updateError } = await db
    .from("appointments")
    .update({
      status: "confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", appt.id)
    .eq("organization_id", context.organization_id);

  if (updateError) return failureResult(updateError.message);

  // 3. Notifica lead via WhatsApp (fire-and-forget)
  const confirmedAppt = { ...appt, status: "confirmed" } as Parameters<
    typeof notifyLeadAppointmentConfirmed
  >[0];
  void notifyLeadAppointmentConfirmed(confirmedAppt).catch((err) => {
    logError("confirm_appointment_notify_failed", {
      organization_id: context.organization_id,
      appointment_id: appt.id,
      error: errorMessage(err),
    });
  });

  // 4. Log no historico do lead
  try {
    await insertLeadActivity({
      db,
      organizationId: context.organization_id,
      leadId: appt.lead_id!,
      type: "appointment_confirmed",
      description: `IA confirmou agendamento "${appt.title}" para ${appt.start_at}`,
      metadata: {
        appointment_id: appt.id,
        start_at: appt.start_at,
        end_at: appt.end_at,
        previous_status: "awaiting_confirmation",
      },
    });
  } catch (err) {
    // Best-effort — confirmacao ja foi feita, nao desfazer por falha de log
    logError("confirm_appointment_activity_failed", {
      organization_id: context.organization_id,
      appointment_id: appt.id,
      error: errorMessage(err),
    });
  }

  return successResult(
    {
      appointment_id: appt.id,
      title: appt.title,
      start_at: appt.start_at,
      end_at: appt.end_at,
      status: "confirmed",
      noop: false,
    },
    [`confirmed appointment "${appt.title}" (${appt.start_at}) — lead notified via WhatsApp`],
  );
};
