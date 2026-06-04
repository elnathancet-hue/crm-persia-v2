import "server-only";

import type {
  AgentFollowup,
  AgentNotificationTemplate,
  NotificationFixedVariables,
} from "@persia/shared/ai-agent";
import { renderNotificationTemplate } from "@persia/shared/ai-agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProvider } from "@/lib/whatsapp/providers";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import { errorMessage, logError, logInfo } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "../db";
import { buildNotificationWaLink } from "../notifications";

const MAX_PROCESSED_PER_TICK = 200;
const MAX_JOB_ATTEMPTS = 3;
const RETRY_BACKOFF_MINUTES = [1, 5, 15];
const DEFAULT_APP_URL = "https://crm.funilpersia.top";

export interface FollowupTickResult {
  started_at: string;
  finished_at: string;
  followups_loaded: number;
  conversations_matched: number;
  fired: number;
  skipped: number;
  paused: number;
  cancelled: number;
  finished: number;
  errors: number;
  error_samples: Array<{
    followup_id: string;
    conversation_id: string;
    error: string;
  }>;
}

type ConfigRow = { name: string; status: string } | null;
type ConversationControlRow = { status: string | null; assigned_to: string | null } | null;

interface ConversationRow {
  id: string;
  organization_id: string;
  config_id: string;
  lead_id: string | null;
  crm_conversation_id: string | null;
  last_interaction_at: string | null;
  human_handoff_at: string | null;
}

interface FollowupJobRow {
  id: string;
  organization_id: string;
  config_id: string;
  agent_conversation_id: string;
  crm_conversation_id: string | null;
  lead_id: string | null;
  followup_id: string;
  sequence_key: string;
  order_index: number;
  send_at: string;
  status: string;
  attempts: number;
}

interface MessageRow {
  id?: string;
  sender: string;
  created_at: string | null;
}

interface LeadRow {
  name?: string | null;
  phone?: string | null;
}

interface Evaluation {
  status: "waiting" | "eligible" | "paused" | "cancelled" | "finished";
  followup?: AgentFollowup;
  nextRunAt?: Date;
  lastCompanyMessageAt?: string | null;
  lastLeadMessageAt?: string | null;
  lastSentAt?: string | null;
  sequenceKey?: string | null;
  reason?: string;
}

function idleResult(now: Date): FollowupTickResult {
  const iso = now.toISOString();
  return {
    started_at: iso,
    finished_at: iso,
    followups_loaded: 0,
    conversations_matched: 0,
    fired: 0,
    skipped: 0,
    paused: 0,
    cancelled: 0,
    finished: 0,
    errors: 0,
    error_samples: [],
  };
}

export async function runFollowupsTick(
  db: AgentDb = asAgentDb(createAdminClient()),
): Promise<FollowupTickResult> {
  const startedAt = new Date();
  const result = idleResult(startedAt);
  const followups = await loadEnabledFollowups(db);
  result.followups_loaded = followups.length;
  if (followups.length === 0) {
    result.finished_at = new Date().toISOString();
    return result;
  }

  const groups = groupFollowups(followups);
  const providerCache = new Map<string, WhatsAppProvider | null>();
  const configCache = new Map<string, ConfigRow>();
  let jobsProcessed = 0;

  for (const group of groups) {
    if (jobsProcessed >= MAX_PROCESSED_PER_TICK) break;

    const config = await getOrLoadConfig(db, group.organizationId, group.configId, configCache);
    if (!config || config.status !== "active") continue;

    const templates = await loadTemplatesForFollowups(db, group.followups);
    const readyFollowups = group.followups.filter((followup) => {
      if (followup.message_text?.trim()) return true;
      const template = followup.template_id
        ? templates.get(followup.template_id) ?? null
        : null;
      return template?.status === "active";
    });
    if (readyFollowups.length === 0) continue;

    const candidates = await loadCandidateConversations(db, {
      organizationId: group.organizationId,
      configId: group.configId,
      minDelayHours: Math.min(...readyFollowups.map((f) => f.delay_hours)),
    });
    result.conversations_matched += candidates.length;

    for (const conversation of candidates) {
      const evaluation = await evaluateConversation(db, readyFollowups, conversation, new Date());
      await persistConversationState(db, conversation, evaluation);
      await syncFollowupJobForEvaluation(db, conversation, evaluation);
      if (evaluation.status === "waiting") result.skipped++;
      if (evaluation.status === "paused") result.paused++;
      if (evaluation.status === "cancelled") result.cancelled++;
      if (evaluation.status === "finished") result.finished++;
    }

    const dueJobs = await loadDueJobs(db, {
      organizationId: group.organizationId,
      configId: group.configId,
      limit: MAX_PROCESSED_PER_TICK - jobsProcessed,
    });
    if (dueJobs.length === 0) continue;

    const provider = await getOrLoadProvider(db, group.organizationId, providerCache);
    if (!provider) {
      result.skipped += dueJobs.length;
      continue;
    }

    const followupById = new Map(readyFollowups.map((followup) => [followup.id, followup]));

    for (const job of dueJobs) {
      if (jobsProcessed >= MAX_PROCESSED_PER_TICK) break;
      jobsProcessed++;

      const followup = followupById.get(job.followup_id);
      const conversation = conversationFromJob(job);
      if (!followup) {
        await markJobSkipped(db, job, "followup_disabled_or_missing");
        result.skipped++;
        continue;
      }

      const evaluation = await evaluateConversation(db, readyFollowups, conversation, new Date());
      await persistConversationState(db, conversation, evaluation);

      if (evaluation.status === "waiting") {
        await rescheduleJob(db, job, evaluation.nextRunAt ?? new Date(job.send_at));
        result.skipped++;
        continue;
      }
      if (evaluation.status === "paused") {
        if (evaluation.nextRunAt) {
          await rescheduleJob(db, job, evaluation.nextRunAt);
        }
        result.paused++;
        continue;
      }
      if (evaluation.status === "cancelled") {
        await cancelQueuedJobsForConversation(db, conversation, evaluation.reason ?? "cancelled");
        result.cancelled++;
        continue;
      }
      if (evaluation.status === "finished") {
        await markJobSkipped(db, job, "sequence_completed");
        result.finished++;
        continue;
      }

      if (!evaluation.followup || evaluation.followup.id !== followup.id) {
        await rescheduleJob(db, job, evaluation.nextRunAt ?? new Date());
        result.skipped++;
        continue;
      }
      if (evaluation.sequenceKey && evaluation.sequenceKey !== job.sequence_key) {
        await markJobSkipped(db, job, "superseded_by_new_company_message");
        await syncFollowupJobForEvaluation(db, conversation, evaluation);
        result.skipped++;
        continue;
      }
      const template = followup.template_id
        ? templates.get(followup.template_id) ?? null
        : null;
      if (!template && !followup.message_text?.trim()) {
        await markJobSkipped(db, job, "missing_message_source");
        result.skipped++;
        continue;
      }

      const claimedJob = await claimJob(db, job);
      if (!claimedJob) {
        result.skipped++;
        continue;
      }

      const outcome = await dispatchFollowup({
        db,
        followup,
        job: claimedJob,
        template,
        agentName: config.name,
        conversation,
        provider,
      });

      if (outcome.fired) {
        result.fired++;
        await persistConversationState(db, conversation, {
          ...evaluation,
          status: "waiting",
          nextRunAt: nextFollowupRunDate(readyFollowups, followup, new Date()),
          lastSentAt: new Date().toISOString(),
        });
        await scheduleNextFollowupJob(
          db,
          conversation,
          readyFollowups,
          followup,
          job.sequence_key,
          new Date(),
        );
      } else if (outcome.error) {
        result.errors++;
        if (result.error_samples.length < 5) {
          result.error_samples.push({
            followup_id: followup.id,
            conversation_id: conversation.id,
            error: outcome.error,
          });
        }
      } else {
        result.skipped++;
      }
    }
  }

  result.finished_at = new Date().toISOString();
  logInfo("ai_agent_followups_tick_completed", {
    organization_id: null,
    request_id: null,
    followups_loaded: result.followups_loaded,
    conversations_matched: result.conversations_matched,
    fired: result.fired,
    skipped: result.skipped,
    paused: result.paused,
    cancelled: result.cancelled,
    finished: result.finished,
    errors: result.errors,
  });
  return result;
}

function groupFollowups(followups: AgentFollowup[]) {
  const grouped = new Map<string, {
    organizationId: string;
    configId: string;
    followups: AgentFollowup[];
  }>();
  for (const followup of followups) {
    const key = `${followup.organization_id}:${followup.config_id}`;
    const group = grouped.get(key) ?? {
      organizationId: followup.organization_id,
      configId: followup.config_id,
      followups: [],
    };
    group.followups.push(followup);
    grouped.set(key, group);
  }
  return [...grouped.values()].map((group) => ({
    ...group,
    followups: group.followups
      .slice()
      .sort((a, b) => a.order_index - b.order_index || a.delay_hours - b.delay_hours),
  }));
}

async function loadEnabledFollowups(db: AgentDb): Promise<AgentFollowup[]> {
  const { data, error } = await db
    .from("agent_followups")
    .select("*")
    .eq("is_enabled", true)
    .order("organization_id", { ascending: true })
    .order("config_id", { ascending: true })
    .order("order_index", { ascending: true });
  if (error) {
    logError("ai_agent_followups_tick_load_failed", {
      organization_id: null,
      error: error.message,
    });
    return [];
  }
  return ((data ?? []) as AgentFollowup[]).map(withFollowupDefaults);
}

function withFollowupDefaults(followup: AgentFollowup): AgentFollowup {
  return {
    ...followup,
    send_window_start: followup.send_window_start ?? "08:00",
    send_window_end: followup.send_window_end ?? "18:00",
    require_ai_active: followup.require_ai_active ?? true,
  };
}

async function loadTemplatesForFollowups(
  db: AgentDb,
  followups: AgentFollowup[],
): Promise<Map<string, AgentNotificationTemplate>> {
  const ids = [
    ...new Set(
      followups
        .map((f) => f.template_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const orgId = followups[0]?.organization_id;
  if (!orgId || ids.length === 0) return new Map();
  const { data, error } = await db
    .from("agent_notification_templates")
    .select("*")
    .eq("organization_id", orgId)
    .in("id", ids);
  if (error) {
    logError("ai_agent_followups_template_load_failed", {
      organization_id: orgId,
      error: error.message,
    });
    return new Map();
  }
  return new Map(
    ((data ?? []) as AgentNotificationTemplate[]).map((template) => [template.id, template]),
  );
}

async function getOrLoadConfig(
  db: AgentDb,
  orgId: string,
  configId: string,
  cache: Map<string, ConfigRow>,
): Promise<ConfigRow> {
  if (cache.has(configId)) return cache.get(configId) ?? null;
  const { data } = await db
    .from("agent_configs")
    .select("name, status")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();
  const value = (data as ConfigRow) ?? null;
  cache.set(configId, value);
  return value;
}

async function getOrLoadProvider(
  db: AgentDb,
  orgId: string,
  cache: Map<string, WhatsAppProvider | null>,
): Promise<WhatsAppProvider | null> {
  if (cache.has(orgId)) return cache.get(orgId) ?? null;
  const { data, error } = await db
    .from("whatsapp_connections")
    .select(
      "provider, instance_url, instance_token, phone_number_id, waba_id, access_token, webhook_verify_token",
    )
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .maybeSingle();
  if (error || !data) {
    cache.set(orgId, null);
    return null;
  }
  try {
    const provider = createProvider(data as Record<string, unknown>);
    cache.set(orgId, provider);
    return provider;
  } catch (err: unknown) {
    logError("ai_agent_followups_provider_factory_failed", {
      organization_id: orgId,
      error: errorMessage(err),
    });
    cache.set(orgId, null);
    return null;
  }
}

async function loadCandidateConversations(
  db: AgentDb,
  params: { organizationId: string; configId: string; minDelayHours: number },
): Promise<ConversationRow[]> {
  const threshold = new Date(
    Date.now() - params.minDelayHours * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await db
    .from("agent_conversations")
    .select("id, organization_id, config_id, lead_id, crm_conversation_id, last_interaction_at, human_handoff_at")
    .eq("organization_id", params.organizationId)
    .eq("config_id", params.configId)
    .is("human_handoff_at", null)
    .lt("last_interaction_at", threshold)
    .order("last_interaction_at", { ascending: true })
    .limit(MAX_PROCESSED_PER_TICK);
  if (error) {
    logError("ai_agent_followups_due_load_failed", {
      organization_id: params.organizationId,
      config_id: params.configId,
      error: error.message,
    });
    return [];
  }
  return (data ?? []) as ConversationRow[];
}

async function loadDueJobs(
  db: AgentDb,
  params: { organizationId: string; configId: string; limit: number },
): Promise<FollowupJobRow[]> {
  if (params.limit <= 0) return [];
  const { data, error } = await db
    .from("agent_followup_jobs")
    .select("id, organization_id, config_id, agent_conversation_id, crm_conversation_id, lead_id, followup_id, sequence_key, order_index, send_at, status, attempts")
    .eq("organization_id", params.organizationId)
    .eq("config_id", params.configId)
    .eq("status", "queued")
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(params.limit);
  if (error) {
    logError("ai_agent_followup_jobs_load_failed", {
      organization_id: params.organizationId,
      config_id: params.configId,
      error: error.message,
    });
    return [];
  }
  return (data ?? []) as FollowupJobRow[];
}

async function claimJob(db: AgentDb, job: FollowupJobRow): Promise<FollowupJobRow | null> {
  if (!db.rpc) {
    logError("ai_agent_followup_job_claim_unavailable", {
      organization_id: job.organization_id,
      job_id: job.id,
    });
    return null;
  }
  const { data, error } = await db.rpc("claim_agent_followup_job", {
    p_job_id: job.id,
    p_worker_id: "followups-tick",
  });
  if (error) {
    logError("ai_agent_followup_job_claim_failed", {
      organization_id: job.organization_id,
      job_id: job.id,
      error: error.message,
    });
    return null;
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return (rows[0] as FollowupJobRow | undefined) ?? null;
}

function conversationFromJob(job: FollowupJobRow): ConversationRow {
  return {
    id: job.agent_conversation_id,
    organization_id: job.organization_id,
    config_id: job.config_id,
    lead_id: job.lead_id,
    crm_conversation_id: job.crm_conversation_id,
    last_interaction_at: null,
    human_handoff_at: null,
  };
}

async function syncFollowupJobForEvaluation(
  db: AgentDb,
  conversation: ConversationRow,
  evaluation: Evaluation,
): Promise<void> {
  if (evaluation.status === "cancelled") {
    await cancelQueuedJobsForConversation(db, conversation, evaluation.reason ?? "cancelled");
    return;
  }
  if (evaluation.status === "finished") {
    await cancelQueuedJobsForConversation(db, conversation, "sequence_completed");
    return;
  }
  if (!evaluation.followup || !evaluation.nextRunAt || !evaluation.sequenceKey) return;
  if (evaluation.status !== "waiting" && evaluation.status !== "eligible" && evaluation.status !== "paused") {
    return;
  }
  const { error } = await db.from("agent_followup_jobs").upsert({
    organization_id: conversation.organization_id,
    config_id: conversation.config_id,
    agent_conversation_id: conversation.id,
    crm_conversation_id: conversation.crm_conversation_id,
    lead_id: conversation.lead_id,
    followup_id: evaluation.followup.id,
    sequence_key: evaluation.sequenceKey,
    order_index: evaluation.followup.order_index,
    send_at: evaluation.nextRunAt.toISOString(),
    status: "queued",
    cancel_reason: null,
    skip_reason: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_conversation_id,followup_id,sequence_key" });
  if (error) {
    logError("ai_agent_followup_job_sync_failed", {
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      followup_id: evaluation.followup.id,
      error: error.message,
    });
  }
}

async function scheduleNextFollowupJob(
  db: AgentDb,
  conversation: ConversationRow,
  followups: AgentFollowup[],
  current: AgentFollowup,
  sequenceKey: string,
  sentAt: Date,
): Promise<void> {
  const next = followups[followups.findIndex((followup) => followup.id === current.id) + 1];
  if (!next) return;
  await syncFollowupJobForEvaluation(db, conversation, {
    status: "waiting",
    followup: next,
    sequenceKey,
    nextRunAt: new Date(sentAt.getTime() + next.delay_hours * 60 * 60 * 1000),
  });
}

async function rescheduleJob(db: AgentDb, job: FollowupJobRow, sendAt: Date): Promise<void> {
  const { error } = await db
    .from("agent_followup_jobs")
    .update({
      status: "queued",
      send_at: sendAt.toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", job.organization_id)
    .eq("id", job.id)
    .eq("status", "queued");
  if (error) {
    logError("ai_agent_followup_job_reschedule_failed", {
      organization_id: job.organization_id,
      job_id: job.id,
      error: error.message,
    });
  }
}

async function markJobSkipped(db: AgentDb, job: FollowupJobRow, reason: string): Promise<void> {
  const { error } = await db
    .from("agent_followup_jobs")
    .update({
      status: "skipped",
      skip_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", job.organization_id)
    .eq("id", job.id);
  if (error) {
    logError("ai_agent_followup_job_skip_failed", {
      organization_id: job.organization_id,
      job_id: job.id,
      reason,
      error: error.message,
    });
  }
}

async function cancelQueuedJobsForConversation(
  db: AgentDb,
  conversation: ConversationRow,
  reason: string,
): Promise<void> {
  const { error } = await db
    .from("agent_followup_jobs")
    .update({
      status: "cancelled",
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", conversation.organization_id)
    .eq("agent_conversation_id", conversation.id)
    .in("status", ["queued", "sending"]);
  if (error) {
    logError("ai_agent_followup_jobs_cancel_failed", {
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      reason,
      error: error.message,
    });
  }
}

async function evaluateConversation(
  db: AgentDb,
  followups: AgentFollowup[],
  conversation: ConversationRow,
  now: Date,
): Promise<Evaluation> {
  if (!conversation.lead_id || !conversation.crm_conversation_id) {
    return { status: "cancelled", reason: "missing_lead_or_conversation" };
  }

  const conversationControl = await loadCrmConversationControl(db, conversation);
  if (conversationControl?.status === "closed") {
    return { status: "cancelled", reason: "conversation_closed" };
  }

  const messages = await loadRecentMessages(db, conversation);
  const lastCompany = messages.find((m) => isCompanySender(m.sender));
  const lastLead = messages.find((m) => m.sender === "lead");
  const latest = messages[0];

  if (!latest || !lastCompany?.created_at) {
    return { status: "waiting", reason: "no_company_message" };
  }

  const sequenceKey = buildSequenceKey(conversation, lastCompany);

  if (latest.sender === "lead") {
    return {
      status: "cancelled",
      reason: "lead_replied",
      lastCompanyMessageAt: lastCompany.created_at,
      lastLeadMessageAt: lastLead?.created_at ?? null,
      sequenceKey,
    };
  }

  if (
    lastLead?.created_at &&
    new Date(lastLead.created_at).getTime() > new Date(lastCompany.created_at).getTime()
  ) {
    return {
      status: "cancelled",
      reason: "lead_replied_after_company",
      lastCompanyMessageAt: lastCompany.created_at,
      lastLeadMessageAt: lastLead.created_at,
      sequenceKey,
    };
  }

  const sentRuns = await loadSentRuns(db, conversation, followups, sequenceKey);
  const next = followups.find((followup) => !sentRuns.has(followup.id));
  if (!next) {
    return {
      status: "finished",
      reason: "sequence_completed",
      lastCompanyMessageAt: lastCompany.created_at,
      lastLeadMessageAt: lastLead?.created_at ?? null,
      sequenceKey,
    };
  }

  if (
    next.require_ai_active &&
    (!conversationControl ||
      conversationControl.status !== "active" ||
      conversationControl.assigned_to !== "ai")
  ) {
    return {
      status: "paused",
      followup: next,
      reason: "ai_inactive",
      lastCompanyMessageAt: lastCompany.created_at,
      lastLeadMessageAt: lastLead?.created_at ?? null,
      sequenceKey,
    };
  }

  const baseAt = lastSequenceTouchAt(followups, sentRuns, lastCompany.created_at);
  const dueAt = new Date(
    new Date(baseAt).getTime() + next.delay_hours * 60 * 60 * 1000,
  );
  if (now.getTime() < dueAt.getTime()) {
    return {
      status: "waiting",
      followup: next,
      nextRunAt: dueAt,
      lastCompanyMessageAt: lastCompany.created_at,
      lastLeadMessageAt: lastLead?.created_at ?? null,
      sequenceKey,
    };
  }

  const window = evaluateSendWindow(now, next);
  if (!window.allowed) {
    return {
      status: "paused",
      followup: next,
      nextRunAt: window.nextRunAt,
      reason: "outside_send_window",
      lastCompanyMessageAt: lastCompany.created_at,
      lastLeadMessageAt: lastLead?.created_at ?? null,
      sequenceKey,
    };
  }

  return {
    status: "eligible",
    followup: next,
    nextRunAt: now,
    lastCompanyMessageAt: lastCompany.created_at,
    lastLeadMessageAt: lastLead?.created_at ?? null,
    sequenceKey,
  };
}

async function loadRecentMessages(
  db: AgentDb,
  conversation: ConversationRow,
): Promise<MessageRow[]> {
  if (!conversation.crm_conversation_id) return [];
  const { data, error } = await db
    .from("messages")
    .select("id, sender, created_at")
    .eq("organization_id", conversation.organization_id)
    .eq("conversation_id", conversation.crm_conversation_id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return (data ?? []) as MessageRow[];
}

async function loadCrmConversationControl(
  db: AgentDb,
  conversation: ConversationRow,
): Promise<ConversationControlRow> {
  if (!conversation.crm_conversation_id) return null;
  const { data, error } = await db
    .from("conversations")
    .select("status, assigned_to")
    .eq("organization_id", conversation.organization_id)
    .eq("id", conversation.crm_conversation_id)
    .maybeSingle();
  if (error) return null;
  const row = data as ConversationControlRow;
  return row ?? null;
}

async function loadSentRuns(
  db: AgentDb,
  conversation: ConversationRow,
  followups: AgentFollowup[],
  sequenceKey: string,
): Promise<Map<string, string>> {
  const { data } = await db
    .from("agent_followup_runs")
    .select("followup_id, status, sent_at, fired_at")
    .eq("organization_id", conversation.organization_id)
    .eq("conversation_id", conversation.id)
    .eq("sequence_key", sequenceKey)
    .in("followup_id", followups.map((f) => f.id))
    .eq("status", "sent");
  return new Map(
    ((data ?? []) as Array<{ followup_id: string; sent_at?: string | null; fired_at?: string | null }>)
      .map((row) => [row.followup_id, row.sent_at ?? row.fired_at ?? new Date(0).toISOString()]),
  );
}

function buildSequenceKey(conversation: ConversationRow, lastCompany: MessageRow): string {
  const marker = lastCompany.id ?? lastCompany.created_at ?? "unknown";
  return `${conversation.id}:${marker}`;
}

function lastSequenceTouchAt(
  followups: AgentFollowup[],
  sentRuns: Map<string, string>,
  fallback: string,
): string {
  let latest = fallback;
  for (const followup of followups) {
    const sentAt = sentRuns.get(followup.id);
    if (!sentAt) continue;
    if (new Date(sentAt).getTime() > new Date(latest).getTime()) {
      latest = sentAt;
    }
  }
  return latest;
}

function isCompanySender(sender: string): boolean {
  return sender === "ai" || sender === "agent";
}

function evaluateSendWindow(
  now: Date,
  followup: AgentFollowup,
): { allowed: true; nextRunAt: Date } | { allowed: false; nextRunAt: Date } {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeMinutes(followup.send_window_start);
  const endMinutes = parseTimeMinutes(followup.send_window_end);
  if (nowMinutes >= startMinutes && nowMinutes < endMinutes) {
    return { allowed: true, nextRunAt: now };
  }
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (nowMinutes >= endMinutes) {
    next.setDate(next.getDate() + 1);
  }
  next.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return { allowed: false, nextRunAt: next };
}

function parseTimeMinutes(value: string): number {
  const [h, m] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 8 * 60;
  return h * 60 + m;
}

function nextFollowupRunDate(
  followups: AgentFollowup[],
  current: AgentFollowup,
  sentAt: Date,
): Date | undefined {
  const index = followups.findIndex((followup) => followup.id === current.id);
  const next = index >= 0 ? followups[index + 1] : undefined;
  if (!next) return undefined;
  return new Date(sentAt.getTime() + next.delay_hours * 60 * 60 * 1000);
}

async function persistConversationState(
  db: AgentDb,
  conversation: ConversationRow,
  evaluation: Evaluation,
): Promise<void> {
  const { error } = await db.from("agent_followup_conversation_states").upsert({
    organization_id: conversation.organization_id,
    config_id: conversation.config_id,
    agent_conversation_id: conversation.id,
    current_followup_id: evaluation.followup?.id ?? null,
    current_order_index: evaluation.followup?.order_index ?? 0,
    status: evaluation.status === "eligible" ? "eligible" : evaluation.status,
    next_run_at: evaluation.nextRunAt?.toISOString() ?? null,
    last_company_message_at: evaluation.lastCompanyMessageAt ?? null,
    last_lead_message_at: evaluation.lastLeadMessageAt ?? null,
    last_sent_at: evaluation.lastSentAt ?? null,
    pause_reason: evaluation.status === "paused" ? evaluation.reason ?? null : null,
    cancel_reason: evaluation.status === "cancelled" ? evaluation.reason ?? null : null,
    finalized_at: evaluation.status === "finished" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_conversation_id" });
  if (error) {
    logError("ai_agent_followup_state_persist_failed", {
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      status: evaluation.status,
      error: error.message,
    });
  }
}

interface DispatchParams {
  db: AgentDb;
  followup: AgentFollowup;
  job: FollowupJobRow;
  template: AgentNotificationTemplate | null;
  agentName: string;
  conversation: ConversationRow;
  provider: WhatsAppProvider;
}

interface DispatchOutcome {
  fired: boolean;
  error?: string;
}

async function dispatchFollowup(params: DispatchParams): Promise<DispatchOutcome> {
  const { db, followup, job, template, agentName, conversation, provider } = params;

  const recheck = await evaluateConversation(db, [followup], conversation, new Date());
  if (recheck.status !== "eligible" || recheck.sequenceKey !== job.sequence_key) {
    return { fired: false };
  }

  const { data: leadRow, error: leadError } = await db
    .from("leads")
    .select("name, phone")
    .eq("organization_id", conversation.organization_id)
    .eq("id", conversation.lead_id)
    .maybeSingle();
  if (leadError) {
    await markJobFailed(db, job, `lead lookup failed: ${leadError.message}`, { retryable: true });
    return { fired: false, error: `lead lookup failed: ${leadError.message}` };
  }
  const lead = (leadRow as LeadRow | null) ?? null;
  if (!lead?.phone) {
    await markJobSkipped(db, job, "lead_without_phone");
    return { fired: false };
  }

  const { error: runInsertError } = await db.from("agent_followup_runs").insert({
    organization_id: conversation.organization_id,
    followup_id: followup.id,
    conversation_id: conversation.id,
    sequence_key: job.sequence_key,
    status: "sending",
  });
  if (runInsertError) {
    const code = (runInsertError as { code?: string }).code;
    if (code === "23505") {
      await markJobSkipped(db, job, "already_sent");
      return { fired: false };
    }
    await markJobFailed(db, job, `run insert failed: ${runInsertError.message}`, { retryable: true });
    return { fired: false, error: `run insert failed: ${runInsertError.message}` };
  }

  const fixed: NotificationFixedVariables = {
    lead_name: lead.name?.trim() || "cliente",
    lead_phone: lead.phone.replace(/\D/g, ""),
    wa_link: conversation.crm_conversation_id
      ? buildNotificationWaLink(conversation.crm_conversation_id)
      : `${process.env.PERSIA_APP_URL ?? DEFAULT_APP_URL}/chat`,
    agent_name: agentName,
  };

  let renderedBody: string;
  try {
    const bodyTemplate = template?.body_template ?? followup.message_text ?? "";
    renderedBody = renderNotificationTemplate(bodyTemplate, fixed, undefined);
  } catch (err: unknown) {
    await markRunFailed(db, conversation, followup, job.sequence_key, `render failed: ${errorMessage(err)}`);
    await markJobFailed(db, job, `render failed: ${errorMessage(err)}`, { retryable: false });
    return { fired: false, error: `render failed: ${errorMessage(err)}` };
  }

  try {
    await provider.sendText({
      phone: fixed.lead_phone,
      message: renderedBody,
    });
    const runUpdate = await db
      .from("agent_followup_runs")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("organization_id", conversation.organization_id)
      .eq("followup_id", followup.id)
      .eq("conversation_id", conversation.id)
      .eq("sequence_key", job.sequence_key);
    if (runUpdate.error) {
      await markJobFailed(db, job, `run sent update failed: ${runUpdate.error.message}`, { retryable: true });
      return { fired: false, error: `run sent update failed: ${runUpdate.error.message}` };
    }
    const jobUpdate = await db
      .from("agent_followup_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", job.organization_id)
      .eq("id", job.id);
    if (jobUpdate.error) {
      logError("ai_agent_followup_job_sent_update_failed", {
        organization_id: job.organization_id,
        job_id: job.id,
        error: jobUpdate.error.message,
      });
      return { fired: false, error: `job sent update failed: ${jobUpdate.error.message}` };
    }
    return { fired: true };
  } catch (err: unknown) {
    const message = errorMessage(err);
    await markRunFailed(db, conversation, followup, job.sequence_key, `send failed: ${message}`);
    await markJobFailed(db, job, `send failed: ${message}`, { retryable: true });
    logError("ai_agent_followups_send_failed", {
      organization_id: conversation.organization_id,
      followup_id: followup.id,
      conversation_id: conversation.id,
      lead_id: conversation.lead_id,
      error: message,
    });
    return { fired: false, error: `send failed: ${message}` };
  }
}

async function markJobFailed(
  db: AgentDb,
  job: FollowupJobRow,
  message: string,
  options: { retryable: boolean },
): Promise<void> {
  const shouldRetry = options.retryable && job.attempts < MAX_JOB_ATTEMPTS;
  const nextAttemptIndex = Math.min(job.attempts, RETRY_BACKOFF_MINUTES.length - 1);
  const retryAt = new Date(Date.now() + RETRY_BACKOFF_MINUTES[nextAttemptIndex] * 60 * 1000);
  const patch = shouldRetry
    ? {
        status: "queued",
        send_at: retryAt.toISOString(),
        last_error: message,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      }
    : {
        status: "failed",
        last_error: message,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      };
  const { error } = await db
    .from("agent_followup_jobs")
    .update(patch)
    .eq("organization_id", job.organization_id)
    .eq("id", job.id);
  if (error) {
    logError("ai_agent_followup_job_failed_update_failed", {
      organization_id: job.organization_id,
      job_id: job.id,
      retryable: options.retryable,
      attempted_status: patch.status,
      error: error.message,
    });
  }
}

async function markRunFailed(
  db: AgentDb,
  conversation: ConversationRow,
  followup: AgentFollowup,
  sequenceKey: string,
  message: string,
): Promise<void> {
  const { error } = await db
    .from("agent_followup_runs")
    .update({ status: "failed", error_message: message })
    .eq("organization_id", conversation.organization_id)
    .eq("followup_id", followup.id)
    .eq("conversation_id", conversation.id)
    .eq("sequence_key", sequenceKey);
  if (error) {
    logError("ai_agent_followup_run_failed_update_failed", {
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      followup_id: followup.id,
      error: error.message,
    });
  }
}
