import "server-only";

import type {
  AgentConfig,
  AgentNotificationTemplate,
  AgentScheduledJob,
  ScheduledJobRunResult,
} from "@persia/shared/ai-agent";
import { errorMessage, logError, logInfo } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { asAgentDb, type AgentDb } from "../db";
import { loadNotificationTemplateById } from "../notifications";
import { computeNextScheduledRunAt } from "./cron-parser";
import {
  dispatchScheduledLeadNotification,
  loadSchedulerProvider,
} from "./dispatcher";
import { resolveScheduledJobLeads } from "./lead-resolver";

type SchedulerRpcName =
  | "claim_agent_scheduled_job"
  | "complete_agent_scheduled_job"
  | "fail_agent_scheduled_job";

type SchedulerRpcClient = AgentDb & {
  rpc(
    fn: SchedulerRpcName,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

interface ScheduledJobRow extends AgentScheduledJob {
  claimed_at?: string | null;
}

interface ScheduledTickResult extends ScheduledJobRunResult {
  claimed_job_id: string | null;
  processed_jobs: number;
  failed_jobs: number;
  next_run_at: string | null;
}

export async function runScheduledTick(
  db: AgentDb = asAgentDb(createAdminClient()),
): Promise<ScheduledTickResult> {
  const job = await claimScheduledJob(db);
  if (!job) {
    return idleTickResult();
  }

  const startedAt = new Date();
  const scheduledRunId = crypto.randomUUID();
  await db.from("agent_scheduled_runs").insert({
    id: scheduledRunId,
    organization_id: job.organization_id,
    scheduled_job_id: job.id,
    started_at: startedAt.toISOString(),
  });

  let nextRunAt: string | null = null;
  try {
    nextRunAt = computeNextScheduledRunAt(job.cron_expr, startedAt);
    const config = await loadAgentConfig(db, job.organization_id, job.config_id);
    const template = await loadNotificationTemplateById(
      db,
      job.organization_id,
      job.config_id,
      job.template_id,
    );

    if (!template) {
      throw new Error("notification template not found");
    }

    if (template.status !== "active") {
      return await failScheduledJob({
        db,
        job,
        runId: scheduledRunId,
        nextRunAt,
        startedAt,
        error: "notification template is archived",
      });
    }

    const provider = await loadSchedulerProvider(db, job.organization_id);
    const resolved = await resolveScheduledJobLeads({
      db,
      organizationId: job.organization_id,
      configId: job.config_id,
      filter: job.lead_filter,
      now: startedAt,
    });

    const errorSamples: Array<{ lead_id: string; error: string }> = [];
    let leadsProcessed = 0;
    let errors = 0;

    for (const lead of resolved.leads) {
      try {
        await dispatchScheduledLeadNotification({
          config,
          template,
          lead,
          provider,
        });
        leadsProcessed += 1;
      } catch (error) {
        errors += 1;
        if (errorSamples.length < 20) {
          errorSamples.push({
            lead_id: lead.id,
            error: errorMessage(error),
          });
        }
      }
    }

    await finalizeScheduledRun(db, scheduledRunId, {
      finishedAt: new Date(),
      leadsMatched: resolved.matchedCount,
      leadsProcessed,
      leadsSkipped: resolved.skippedCount,
      errors,
      errorSamples,
      startedAt,
    });
    await completeScheduledJob(db, job, leadsProcessed, nextRunAt);

    const result: ScheduledTickResult = {
      claimed_job_id: job.id,
      job_id: job.id,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      leads_matched: resolved.matchedCount,
      leads_processed: leadsProcessed,
      leads_skipped: resolved.skippedCount,
      errors,
      error_samples: errorSamples,
      processed_jobs: 1,
      failed_jobs: 0,
      next_run_at: nextRunAt,
    };

    logInfo("ai_agent_scheduler_tick_completed", {
      organization_id: job.organization_id,
      job_id: job.id,
      leads_matched: result.leads_matched,
      leads_processed: result.leads_processed,
      leads_skipped: result.leads_skipped,
      errors: result.errors,
      next_run_at: nextRunAt,
    });

    return result;
  } catch (error) {
    return await failScheduledJob({
      db,
      job,
      runId: scheduledRunId,
      nextRunAt:
        nextRunAt ?? safeComputeNextRunAt(job.cron_expr, startedAt.toISOString()),
      startedAt,
      error: errorMessage(error),
    });
  }
}

function idleTickResult(): ScheduledTickResult {
  const nowIso = new Date().toISOString();
  return {
    claimed_job_id: null,
    job_id: "",
    started_at: nowIso,
    finished_at: nowIso,
    leads_matched: 0,
    leads_processed: 0,
    leads_skipped: 0,
    errors: 0,
    error_samples: [],
    processed_jobs: 0,
    failed_jobs: 0,
    next_run_at: null,
  };
}

async function claimScheduledJob(db: AgentDb): Promise<ScheduledJobRow | null> {
  const { data, error } = await (db as SchedulerRpcClient).rpc(
    "claim_agent_scheduled_job",
    {},
  );

  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as ScheduledJobRow | null;
}

async function loadAgentConfig(
  db: AgentDb,
  organizationId: string,
  configId: string,
): Promise<Pick<AgentConfig, "id" | "name">> {
  const { data, error } = await db
    .from("agent_configs")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("id", configId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message ?? "agent config not found");
  }

  return data as Pick<AgentConfig, "id" | "name">;
}

async function finalizeScheduledRun(
  db: AgentDb,
  runId: string,
  params: {
    finishedAt: Date;
    startedAt: Date;
    leadsMatched: number;
    leadsProcessed: number;
    leadsSkipped: number;
    errors: number;
    errorSamples: Array<{ lead_id: string; error: string }>;
  },
): Promise<void> {
  await db
    .from("agent_scheduled_runs")
    .update({
      finished_at: params.finishedAt.toISOString(),
      leads_matched: params.leadsMatched,
      leads_processed: params.leadsProcessed,
      leads_skipped: params.leadsSkipped,
      errors: params.errors,
      error_samples: params.errorSamples,
      duration_ms: params.finishedAt.getTime() - params.startedAt.getTime(),
    })
    .eq("id", runId);
}

async function completeScheduledJob(
  db: AgentDb,
  job: ScheduledJobRow,
  leadsProcessed: number,
  nextRunAt: string | null,
): Promise<void> {
  const { error } = await (db as SchedulerRpcClient).rpc(
    "complete_agent_scheduled_job",
    {
      p_job_id: job.id,
      p_organization_id: job.organization_id,
      p_leads_processed: leadsProcessed,
      p_next_run_at: nextRunAt,
    },
  );

  if (error) throw new Error(error.message);
}

async function failScheduledJob(params: {
  db: AgentDb;
  job: ScheduledJobRow;
  runId: string;
  nextRunAt: string | null;
  startedAt: Date;
  error: string;
}): Promise<ScheduledTickResult> {
  const finishedAt = new Date();
  await finalizeScheduledRun(params.db, params.runId, {
    finishedAt,
    startedAt: params.startedAt,
    leadsMatched: 0,
    leadsProcessed: 0,
    leadsSkipped: 0,
    errors: 1,
    errorSamples: [],
  });

  try {
    const { error } = await (params.db as SchedulerRpcClient).rpc(
      "fail_agent_scheduled_job",
      {
        p_job_id: params.job.id,
        p_organization_id: params.job.organization_id,
        p_error_message: params.error,
        p_next_run_at: params.nextRunAt,
      },
    );
    if (error) throw new Error(error.message);
  } catch (error) {
    await params.db
      .from("agent_scheduled_jobs")
      .update({
        last_run_at: finishedAt.toISOString(),
        last_run_error: params.error,
        next_run_at: params.nextRunAt,
        claimed_at: null,
        updated_at: finishedAt.toISOString(),
      })
      .eq("organization_id", params.job.organization_id)
      .eq("id", params.job.id);

    logError("ai_agent_scheduler_fail_rpc_failed", {
      organization_id: params.job.organization_id,
      job_id: params.job.id,
      error: errorMessage(error),
    });
  }

  logError("ai_agent_scheduler_tick_failed", {
    organization_id: params.job.organization_id,
    job_id: params.job.id,
    error: params.error,
    next_run_at: params.nextRunAt,
  });

  return {
    claimed_job_id: params.job.id,
    job_id: params.job.id,
    started_at: params.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    leads_matched: 0,
    leads_processed: 0,
    leads_skipped: 0,
    errors: 1,
    error_samples: [],
    processed_jobs: 1,
    failed_jobs: 1,
    next_run_at: params.nextRunAt,
  };
}

function safeComputeNextRunAt(
  cronExpr: string,
  currentDate: Date | string,
): string | null {
  try {
    return computeNextScheduledRunAt(cronExpr, currentDate);
  } catch {
    return null;
  }
}
