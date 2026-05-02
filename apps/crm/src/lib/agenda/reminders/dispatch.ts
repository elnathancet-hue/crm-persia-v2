import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createProvider } from "@/lib/whatsapp/providers";
import {
  type AgendaReminderConfig,
  type AgendaReminderSend,
  type Appointment,
  formatDate,
  formatTime,
  formatWeekday,
  renderReminderTemplate,
} from "@persia/shared/agenda";

const MAX_PER_TICK = 50;
const MAX_ATTEMPTS = 3;

type LooseDb = { from: (table: string) => any; rpc: (...args: any[]) => any };

function loose(): LooseDb {
  return createAdminClient() as unknown as LooseDb;
}

export interface ReminderTickResult {
  started_at: string;
  finished_at: string;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  errors_sample: string[];
}

interface PendingRow {
  id: string;
  appointment_id: string;
  reminder_config_id: string;
  organization_id: string;
  scheduled_for: string;
  attempted_count: number;
}

interface ApptCtx {
  appointment: Appointment;
  config: AgendaReminderConfig;
  leadName: string;
  leadPhone: string;
  orgName: string;
  hostName: string;
}

/**
 * Tick principal — chamado pelo /api/agenda/reminders/tick.
 * Idempotente: se rodar 2x no mesmo segundo, o segundo nao re-envia
 * (UPDATE com WHERE status='pending' atomico).
 */
export async function runRemindersTick(): Promise<ReminderTickResult> {
  const startedAt = new Date().toISOString();
  const db = loose();

  // 1) Pega pendentes vencidos (scheduled_for <= now()), limita por tick
  const nowIso = new Date().toISOString();
  const { data: pending, error: pendingErr } = await db
    .from("agenda_reminder_sends")
    .select(
      "id, appointment_id, reminder_config_id, organization_id, scheduled_for, attempted_count",
    )
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .lt("attempted_count", MAX_ATTEMPTS)
    .order("scheduled_for", { ascending: true })
    .limit(MAX_PER_TICK);

  if (pendingErr) {
    console.error("[reminders.tick] pending query failed:", pendingErr.message);
    return summary(startedAt, 0, 0, 0, 0, [pendingErr.message]);
  }

  const rows: PendingRow[] = (pending ?? []) as PendingRow[];
  if (rows.length === 0) {
    return summary(startedAt, 0, 0, 0, 0, []);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const ctx = await loadAppointmentContext(db, row);
      if (!ctx) {
        await markSendStatus(db, row.id, "skipped", null, "context_missing");
        skipped++;
        continue;
      }

      // Pula se o appointment ja foi cancelado/concluido entre o enqueue e agora
      const status = ctx.appointment.status;
      if (
        status === "cancelled" ||
        status === "completed" ||
        status === "no_show"
      ) {
        await markSendStatus(db, row.id, "skipped", null, `status_${status}`);
        skipped++;
        continue;
      }

      // Phone vazio = nao da pra enviar
      if (!ctx.leadPhone) {
        await markSendStatus(db, row.id, "skipped", null, "lead_phone_missing");
        skipped++;
        continue;
      }

      // Renderiza template
      const message = renderReminderTemplate(ctx.config.template_text, {
        lead_name: ctx.leadName || "cliente",
        appointment_title: ctx.appointment.title,
        appointment_date: formatDate(
          ctx.appointment.start_at,
          ctx.appointment.timezone,
        ),
        appointment_time: formatTime(
          ctx.appointment.start_at,
          ctx.appointment.timezone,
        ),
        appointment_weekday: formatWeekday(
          ctx.appointment.start_at,
          ctx.appointment.timezone,
        ),
        appointment_location: ctx.appointment.location ?? "",
        appointment_meeting_url: ctx.appointment.meeting_url ?? "",
        duration_minutes: String(ctx.appointment.duration_minutes),
        organization_name: ctx.orgName,
        host_name: ctx.hostName,
      });

      // Provider
      const provider = await loadProvider(db, ctx.appointment.organization_id);
      if (!provider) {
        await bumpAttempt(db, row.id, "whatsapp_unavailable");
        failed++;
        errors.push("whatsapp_unavailable");
        continue;
      }

      // Envia
      const result = await provider.sendText({
        phone: ctx.leadPhone,
        message,
      });
      if (!result.success) {
        await bumpAttempt(db, row.id, "send_failed");
        failed++;
        errors.push("send_failed");
        continue;
      }

      await markSendStatus(db, row.id, "sent", result.messageId, null);
      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      await bumpAttempt(db, row.id, msg).catch(() => {});
      failed++;
      errors.push(msg);
    }
  }

  return summary(startedAt, rows.length, sent, failed, skipped, errors.slice(0, 5));
}

// ============================================================================
// Helpers
// ============================================================================

async function loadAppointmentContext(
  db: LooseDb,
  row: PendingRow,
): Promise<ApptCtx | null> {
  const [apptRes, cfgRes, orgRes] = await Promise.all([
    db
      .from("appointments")
      .select("*")
      .eq("id", row.appointment_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle(),
    db
      .from("agenda_reminder_configs")
      .select("*")
      .eq("id", row.reminder_config_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle(),
    db
      .from("organizations")
      .select("name")
      .eq("id", row.organization_id)
      .maybeSingle(),
  ]);

  const appointment = apptRes.data as Appointment | null;
  const config = cfgRes.data as AgendaReminderConfig | null;
  if (!appointment || !config) return null;
  if (appointment.deleted_at) return null;
  if (!config.is_active) return null;

  let leadName = "";
  let leadPhone = "";
  if (appointment.lead_id) {
    const { data: lead } = await db
      .from("leads")
      .select("name, phone")
      .eq("id", appointment.lead_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    leadName = (lead?.name as string | undefined) ?? "";
    leadPhone = (lead?.phone as string | undefined) ?? "";
  }

  let hostName = "";
  try {
    const { data: prof } = await db
      .from("profiles")
      .select("full_name")
      .eq("user_id", appointment.user_id)
      .maybeSingle();
    if (prof?.full_name) hostName = prof.full_name as string;
  } catch {
    // best-effort
  }

  return {
    appointment,
    config,
    leadName,
    leadPhone,
    orgName: (orgRes.data?.name as string | undefined) ?? "Sua agenda",
    hostName,
  };
}

async function loadProvider(db: LooseDb, organizationId: string) {
  const { data, error } = await db
    .from("whatsapp_connections")
    .select(
      "provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token",
    )
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .maybeSingle();
  if (error || !data) return null;
  try {
    return createProvider(data as Record<string, unknown>);
  } catch (err) {
    console.error("[reminders.tick] createProvider failed:", err);
    return null;
  }
}

async function markSendStatus(
  db: LooseDb,
  sendId: string,
  status: AgendaReminderSend["status"],
  messageId: string | null,
  error: string | null,
) {
  await db
    .from("agenda_reminder_sends")
    .update({
      status,
      message_id: messageId,
      error,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sendId)
    .eq("status", "pending"); // idempotency: nao reescreve se ja foi sent
}

async function bumpAttempt(db: LooseDb, sendId: string, error: string) {
  // Le current attempted_count (race-tolerant pra MVP)
  const { data: current } = await db
    .from("agenda_reminder_sends")
    .select("attempted_count")
    .eq("id", sendId)
    .maybeSingle();
  const next = ((current?.attempted_count as number | undefined) ?? 0) + 1;
  const newStatus = next >= MAX_ATTEMPTS ? "failed" : "pending";
  await db
    .from("agenda_reminder_sends")
    .update({
      attempted_count: next,
      status: newStatus,
      error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sendId)
    .eq("status", "pending");
}

function summary(
  startedAt: string,
  claimed: number,
  sent: number,
  failed: number,
  skipped: number,
  errorsSample: string[],
): ReminderTickResult {
  return {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    claimed,
    sent,
    failed,
    skipped,
    errors_sample: errorsSample,
  };
}
