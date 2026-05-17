import "server-only";

// Dispatch imediato de notificacoes Agenda (cancel/reschedule).
//
// Diferente do `lib/agenda/reminders/dispatch.ts` que e queue-based
// (scheduled_for + cron tick), este modulo envia AGORA, fire-and-forget
// chamado pela server action no momento do evento.
//
// PR-AGENDA-NOTIFY (mai/2026): paridade com fluxo de booking — booking
// dispara lembrete pre-event (via queue), cancel/reschedule disparam
// notificacao imediata (sem queue). Reusa `loadProvider` pattern do
// reminders/dispatch.ts mas inline porque escopos sao diferentes
// (queue x one-off).

import { createAdminClient } from "@/lib/supabase/admin";
import { createProvider } from "@/lib/whatsapp/providers";
import type { Appointment } from "@persia/shared/agenda";
import {
  buildCancellationMessage,
  buildRescheduleMessage,
} from "./messages";

export type NotificationOutcome =
  | { sent: true; messageId: string }
  | { sent: false; reason: NotificationSkipReason };

export type NotificationSkipReason =
  | "no_lead"
  | "lead_phone_missing"
  | "whatsapp_unavailable"
  | "send_failed";

type LooseDb = { from: (table: string) => any };

async function loadLeadContact(
  db: LooseDb,
  orgId: string,
  leadId: string,
): Promise<{ name: string; phone: string } | null> {
  const { data } = await db
    .from("leads")
    .select("name, phone")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data) return null;
  const phone = typeof data.phone === "string" ? data.phone : "";
  if (!phone) return null;
  return {
    name: typeof data.name === "string" ? data.name : "",
    phone,
  };
}

async function loadProvider(db: LooseDb, orgId: string) {
  const { data, error } = await db
    .from("whatsapp_connections")
    .select(
      "provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token",
    )
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .maybeSingle();
  if (error || !data) return null;
  try {
    return createProvider(data as Record<string, unknown>);
  } catch (err) {
    console.error("[agenda-notify] createProvider failed:", err);
    return null;
  }
}

/**
 * Pipeline interno: dado um appointment com lead_id, busca lead +
 * provider e envia a mensagem. Retorna outcome legivel. Throw NUNCA
 * — caller decide se loga ou ignora.
 */
async function dispatch(
  appointment: Appointment,
  buildMessage: (lead: { name: string; phone: string }) => string,
): Promise<NotificationOutcome> {
  if (!appointment.lead_id) {
    return { sent: false, reason: "no_lead" };
  }

  const db = createAdminClient() as unknown as LooseDb;

  const lead = await loadLeadContact(
    db,
    appointment.organization_id,
    appointment.lead_id,
  );
  if (!lead) {
    return { sent: false, reason: "lead_phone_missing" };
  }

  const provider = await loadProvider(db, appointment.organization_id);
  if (!provider) {
    return { sent: false, reason: "whatsapp_unavailable" };
  }

  const result = await provider.sendText({
    phone: lead.phone,
    message: buildMessage(lead),
  });
  if (!result.success) {
    return { sent: false, reason: "send_failed" };
  }
  return { sent: true, messageId: result.messageId };
}

/**
 * Avisa o lead que o agendamento foi cancelado. Caller usa
 * fire-and-forget — nao throwa.
 */
export async function notifyLeadAppointmentCancelled(
  appointment: Appointment,
  reason: string | null,
): Promise<NotificationOutcome> {
  return dispatch(appointment, (lead) =>
    buildCancellationMessage({ appointment, leadName: lead.name, reason }),
  );
}

/**
 * Avisa o lead que o agendamento foi reagendado. Recebe original +
 * replacement do `rescheduleAppointment` shared. Notifica usando o
 * replacement como appointment "ativo" (e que tem o novo horario +
 * mesmo lead_id).
 */
export async function notifyLeadAppointmentRescheduled(
  original: Appointment,
  replacement: Appointment,
): Promise<NotificationOutcome> {
  return dispatch(replacement, (lead) =>
    buildRescheduleMessage({ original, replacement, leadName: lead.name }),
  );
}
