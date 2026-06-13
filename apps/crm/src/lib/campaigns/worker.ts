// worker.ts — worker idempotente de jobs de campanha.
//
// Fluxo por job:
//   1. Busca jobs queued com send_at <= now()
//   2. Lock atômico (update WHERE status='queued')
//   3. Verifica campanha (scheduled/running — senão, libera ou cancela)
//   4. Verifica destinatário (stopped/failed/ineligible → skip)
//   5. Verifica janela de envio (reagenda se fora)
//   6. Envia mensagem via provider
//   7. Atualiza job e grava evento
//
// Retry com backoff exponencial:
//   attempt 1: +1 min, 2: +5 min, 3: +15 min → failed

import { createClient } from "@supabase/supabase-js";
import { createProvider } from "@persia/shared/providers";
import { logError, logInfo } from "@/lib/observability";

// Backoff em ms por tentativa (índice = número de tentativas já feitas)
const BACKOFF_MS = [60_000, 300_000, 900_000]; // 1, 5, 15 min
const MAX_ATTEMPTS = 3;

// Module-level singleton — evita nova instância a cada tick
const _supabaseWorker = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
function getSupabase() {
  return _supabaseWorker;
}

interface WorkerOptions {
  limit?: number;
  workerId?: string;
}

interface JobRow {
  id: string;
  organization_id: string;
  campaign_id: string;
  step_id: string;
  recipient_id: string;
  send_at: string;
  status: string;
  attempts: number;
}

interface StepRow {
  id: string;
  send_mode: string;
  message_text: string | null;
  media_type: string;
  media_url: string | null;
  media_filename: string | null;
  media_mime_type: string | null;
  caption: string | null;
}

interface RecipientRow {
  id: string;
  status: string;
  phone: string | null;
  chat_jid: string | null;
  display_name: string | null;
  lead_id: string | null;
  group_id: string | null;
}

interface CampaignRow {
  id: string;
  organization_id: string;
  status: string;
  send_window_start: string | null;
  send_window_end: string | null;
  timezone: string;
  kind: string;
}

interface ConnectionRow {
  provider: string | null;
  instance_url: string | null;
  instance_token: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token: string | null;
  webhook_verify_token: string | null;
}

export async function processDueCampaignJobs(opts: WorkerOptions = {}): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const limit = opts.limit ?? 50;
  const workerId = opts.workerId ?? `worker-${Date.now()}`;
  const supabase = getSupabase();

  const now = new Date().toISOString();

  // Busca jobs vencidos
  const { data: jobs, error: fetchErr } = await supabase
    .from("crm_campaign_message_jobs")
    .select("id, organization_id, campaign_id, step_id, recipient_id, send_at, status, attempts")
    .eq("status", "queued")
    .lte("send_at", now)
    .order("send_at", { ascending: true })
    .limit(limit);

  if (fetchErr) {
    logError("campaign_worker_fetch_failed", { error: fetchErr.message });
    return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  }

  let sent = 0, failed = 0, skipped = 0;

  // Caches scoped ao tick: evita re-query de campaign/step/conn repetidos
  const campaignCache = new Map<string, CampaignRow | null>();
  const stepCache = new Map<string, StepRow | null>();
  const connCache = new Map<string, ConnectionRow | null>();

  for (const job of (jobs ?? []) as JobRow[]) {
    const result = await processJob(supabase as never, job, workerId, campaignCache, stepCache, connCache);
    if (result === "sent") sent++;
    else if (result === "failed") failed++;
    else if (result === "skipped") skipped++;
  }

  const processed = (jobs ?? []).length;
  logInfo("campaign_worker_tick", { worker_id: workerId, processed, sent, failed, skipped });

  return { processed, sent, failed, skipped };
}

async function processJob(
  supabase: ReturnType<typeof createClient>,
  job: JobRow,
  workerId: string,
  campaignCache: Map<string, CampaignRow | null>,
  stepCache: Map<string, StepRow | null>,
  connCache: Map<string, ConnectionRow | null>,
): Promise<"sent" | "failed" | "skipped" | "locked" | "rescheduled"> {
  // Lock atômico: só atualiza se ainda queued
  const { data: locked, error: lockErr } = await supabase
    .from("crm_campaign_message_jobs")
    .update({
      status: "sending",
      locked_at: new Date().toISOString(),
      locked_by: workerId,
      attempts: job.attempts + 1,
    } as never)
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (lockErr || !locked) return "locked"; // outro worker pegou

  try {
    // Buscar campanha (com cache por campaign_id dentro do tick)
    if (!campaignCache.has(job.campaign_id)) {
      const { data: campaignData } = await supabase
        .from("crm_campaigns")
        .select("id, organization_id, status, send_window_start, send_window_end, timezone, kind")
        .eq("id", job.campaign_id)
        .single();
      campaignCache.set(job.campaign_id, (campaignData as CampaignRow | null) ?? null);
    }
    const c = campaignCache.get(job.campaign_id) ?? null;

    if (!c) {
      await cancelJob(supabase, job.id, "Campanha não encontrada");
      return "skipped";
    }

    if (c.status === "cancelled") {
      await updateJobStatus(supabase, job.id, "cancelled");
      return "skipped";
    }

    if (c.status === "paused") {
      // Libera lock, volta para queued
      await releaseJobWithoutAttempt(supabase, job);
      return "skipped";
    }

    if (c.status !== "scheduled" && c.status !== "running") {
      await cancelJob(supabase, job.id, `Status inválido: ${c.status}`);
      await completeCampaignIfDone(supabase, job.campaign_id);
      return "skipped";
    }

    // Buscar recipient
    const { data: recipient } = await supabase
      .from("crm_campaign_recipients")
      .select("id, status, phone, chat_jid, display_name, lead_id, group_id")
      .eq("id", job.recipient_id)
      .single();

    if (!recipient) {
      await cancelJob(supabase, job.id, "Destinatário não encontrado");
      return "skipped";
    }

    const r = recipient as RecipientRow;
    if (r.status === "stopped" || r.status === "failed" || r.status === "ineligible") {
      await updateJobStatus(supabase, job.id, "skipped");
      await completeCampaignIfDone(supabase, job.campaign_id);
      return "skipped";
    }

    // Verificar janela de envio
    if (c.send_window_start && c.send_window_end) {
      const inWindow = isInSendWindow(c.send_window_start, c.send_window_end, c.timezone);
      if (!inWindow) {
        const nextSendAt = nextWindowStart(c.send_window_start, c.timezone);
        await supabase
          .from("crm_campaign_message_jobs")
          .update({ status: "queued", send_at: nextSendAt, attempts: job.attempts, locked_at: null, locked_by: null } as never)
          .eq("id", job.id);
        return "rescheduled";
      }
    }

    // Buscar step (com cache por step_id dentro do tick)
    if (!stepCache.has(job.step_id)) {
      const { data: stepData } = await supabase
        .from("crm_campaign_steps")
        .select("id, send_mode, message_text, media_type, media_url, media_filename, media_mime_type, caption")
        .eq("id", job.step_id)
        .single();
      stepCache.set(job.step_id, (stepData as StepRow | null) ?? null);
    }
    const step = stepCache.get(job.step_id) ?? null;

    if (!step) {
      await cancelJob(supabase, job.id, "Step não encontrado");
      return "skipped";
    }

    // Buscar conexão WhatsApp (com cache por org dentro do tick)
    if (!connCache.has(c.organization_id)) {
      const { data: connData } = await supabase
        .from("whatsapp_connections")
        .select("provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token")
        .eq("organization_id", c.organization_id)
        .eq("status", "connected")
        .limit(1)
        .maybeSingle();
      connCache.set(c.organization_id, (connData as ConnectionRow | null) ?? null);
    }
    const conn = connCache.get(c.organization_id) ?? null;

    if (!conn) {
      return await retryOrFail(supabase, job, "WhatsApp não conectado");
    }

    const provider = createProvider(conn as ConnectionRow);
    const s = step as StepRow;

    // Resolver destino
    const destination = c.kind === "group_campaign"
      ? await resolveGroupDestination(supabase, r)
      : resolveLeadDestination(r);

    if (!destination) {
      await cancelJob(supabase, job.id, "Sem telefone/JID para envio");
      await updateRecipientStatus(supabase, job.recipient_id, "failed");
      await completeCampaignIfDone(supabase, job.campaign_id);
      return "failed";
    }

    // Enviar
    let providerId: string | undefined;
    try {
      const message = interpolateMessage(s.message_text, r);
      const caption = interpolateMessage(s.caption, r) ?? message ?? undefined;
      if (s.media_type !== "none" && s.media_url) {
        const result = await provider.sendMedia({
          phone: destination,
          type: s.media_type as "image" | "video" | "audio" | "document",
          media: s.media_url,
          fileName: s.media_filename ?? undefined,
          caption,
        });
        providerId = result.messageId;
      } else if (message) {
        const result = await provider.sendText({
          phone: destination,
          message,
        });
        providerId = result.messageId;
      } else {
        await cancelJob(supabase, job.id, "Step sem conteúdo");
        await completeCampaignIfDone(supabase, job.campaign_id);
        return "skipped";
      }
    } catch (sendErr) {
      const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      return await retryOrFail(supabase, job, errMsg);
    }

    // Sucesso
    const sentAt = new Date().toISOString();
    await supabase
      .from("crm_campaign_message_jobs")
      .update({
        status: "sent",
        sent_at: sentAt,
        provider_message_id: providerId ?? null,
        last_error: null,
        locked_at: null,
        locked_by: null,
      } as never)
      .eq("id", job.id);

    await logCampaignEvent(supabase, c.organization_id, job.campaign_id, job.id, job.recipient_id, "job_sent", {
      provider_message_id: providerId,
      destination,
      sent_at: sentAt,
    });

    // Marcar campanha como running ANTES de verificar conclusão — evita que
    // campanhas rápidas (1 job) pulem direto de scheduled → completed.
    if (c.status === "scheduled") {
      await supabase
        .from("crm_campaigns")
        .update({ status: "running" } as never)
        .eq("id", job.campaign_id)
        .eq("status", "scheduled");
    }

    await markRecipientCompletedIfDone(supabase, job.recipient_id);
    await completeCampaignIfDone(supabase, job.campaign_id);

    return "sent";
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError("campaign_worker_job_error", { job_id: job.id, error: errMsg });
    return await retryOrFail(supabase, job, errMsg);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveLeadDestination(r: RecipientRow): string | null {
  return r.chat_jid ?? r.phone ?? null;
}

async function resolveGroupDestination(
  supabase: ReturnType<typeof createClient>,
  r: RecipientRow,
): Promise<string | null> {
  if (!r.group_id) return r.chat_jid ?? null;
  const { data } = await supabase
    .from("whatsapp_groups")
    .select("group_jid")
    .eq("id", r.group_id)
    .maybeSingle();
  return ((data as { group_jid?: string | null } | null)?.group_jid) ?? r.chat_jid ?? null;
}

async function retryOrFail(
  supabase: ReturnType<typeof createClient>,
  job: JobRow,
  errMsg: string,
): Promise<"failed"> {
  const attempts = job.attempts + 1; // attempts was incremented on lock
  if (attempts < MAX_ATTEMPTS) {
    const backoff = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    const nextSendAt = new Date(Date.now() + backoff).toISOString();
    await supabase
      .from("crm_campaign_message_jobs")
      .update({
        status: "queued",
        send_at: nextSendAt,
        last_error: errMsg,
        locked_at: null,
        locked_by: null,
      } as never)
      .eq("id", job.id);
  } else {
    await supabase
      .from("crm_campaign_message_jobs")
      .update({
        status: "failed",
        last_error: errMsg,
        locked_at: null,
        locked_by: null,
      } as never)
      .eq("id", job.id);
    await logCampaignEvent(supabase, job.organization_id, job.campaign_id, job.id, job.recipient_id, "job_failed", { error: errMsg, attempts });
    await updateRecipientStatus(supabase, job.recipient_id, "failed");
    await completeCampaignIfDone(supabase, job.campaign_id);
  }
  return "failed";
}

async function updateJobStatus(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  status: string,
): Promise<void> {
  await supabase
    .from("crm_campaign_message_jobs")
    .update({ status, locked_at: null, locked_by: null } as never)
    .eq("id", jobId);
}

async function releaseJobWithoutAttempt(
  supabase: ReturnType<typeof createClient>,
  job: JobRow,
): Promise<void> {
  await supabase
    .from("crm_campaign_message_jobs")
    .update({
      status: "queued",
      attempts: job.attempts,
      locked_at: null,
      locked_by: null,
    } as never)
    .eq("id", job.id);
}

async function cancelJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("crm_campaign_message_jobs")
    .update({ status: "cancelled", last_error: reason, locked_at: null, locked_by: null } as never)
    .eq("id", jobId);
}

async function updateRecipientStatus(
  supabase: ReturnType<typeof createClient>,
  recipientId: string,
  status: string,
): Promise<void> {
  await supabase
    .from("crm_campaign_recipients")
    .update({ status } as never)
    .eq("id", recipientId);
}

async function markRecipientCompletedIfDone(
  supabase: ReturnType<typeof createClient>,
  recipientId: string,
): Promise<void> {
  const { count } = await supabase
    .from("crm_campaign_message_jobs")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", recipientId)
    .in("status", ["queued", "sending"]);

  if ((count ?? 0) > 0) return;

  await supabase
    .from("crm_campaign_recipients")
    .update({ status: "completed" } as never)
    .eq("id", recipientId)
    .eq("status", "active");
}

async function completeCampaignIfDone(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
): Promise<void> {
  const { count: pendingCount } = await supabase
    .from("crm_campaign_message_jobs")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["queued", "sending"]);

  if ((pendingCount ?? 0) > 0) return;

  const { count: sentCount } = await supabase
    .from("crm_campaign_message_jobs")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "sent");

  const { count: failedCount } = await supabase
    .from("crm_campaign_message_jobs")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "failed");

  // Só marca "failed" se nenhum job foi enviado com sucesso — campanha com
  // parcial de falhas (ex: 1 de 1000) ainda termina como "completed".
  const finalStatus =
    (failedCount ?? 0) > 0 && (sentCount ?? 0) === 0 ? "failed" : "completed";

  await supabase
    .from("crm_campaigns")
    .update({ status: finalStatus } as never)
    .eq("id", campaignId)
    .in("status", ["scheduled", "running"]);
}

async function logCampaignEvent(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  campaignId: string,
  jobId: string,
  recipientId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("crm_campaign_events").insert({
      organization_id: orgId,
      campaign_id: campaignId,
      job_id: jobId,
      recipient_id: recipientId,
      event_type: eventType,
      payload,
    } as never);
  } catch {
    // best-effort — log não pode quebrar worker
  }
}

function isInSendWindow(start: string, end: string, timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const currentMinutes = hour * 60 + minute;

    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } catch {
    return true; // se timezone inválida, permite envio
  }
}

function interpolateMessage(template: string | null, recipient: RecipientRow): string | null {
  if (!template) return null;
  const name = recipient.display_name?.trim() ?? "";
  const firstName = name.split(/\s+/).filter(Boolean)[0] ?? "";
  const phone = recipient.phone ?? recipient.chat_jid?.split("@")[0] ?? "";

  return template
    .replaceAll("{{nome}}", name)
    .replaceAll("{{primeiro_nome}}", firstName)
    .replaceAll("{{telefone}}", phone);
}

function nextWindowStart(windowStart: string, timezone: string): string {
  try {
    const [h, m] = windowStart.split(":").map(Number);
    const now = new Date();

    // Calcula o offset UTC→timezone usando o truque toLocaleString.
    // tzNow representa "agora" interpretado como se o horário da timezone
    // fosse o horário local — permite extrair data/hora na timezone correta.
    const tzNowStr = now.toLocaleString("en-US", { timeZone: timezone });
    const tzNow = new Date(tzNowStr);
    const offsetMs = now.getTime() - tzNow.getTime();

    // Ajusta tzNow para h:m:00 de hoje na timezone da campanha
    const windowToday = new Date(tzNow);
    windowToday.setHours(h, m, 0, 0);
    // Converte de volta para UTC somando o offset
    const windowTodayUTC = windowToday.getTime() + offsetMs;

    if (windowTodayUTC > now.getTime()) {
      return new Date(windowTodayUTC).toISOString();
    }
    // Amanhã na mesma janela
    return new Date(windowTodayUTC + 86_400_000).toISOString();
  } catch {
    return new Date(Date.now() + 3_600_000).toISOString(); // fallback: +1h
  }
}
