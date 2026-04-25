import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  errorMessage,
  getRequestId,
  logError,
  logInfo,
  logWarn,
} from "@/lib/observability";
import { runScheduledTick } from "@/lib/ai-agent/scheduler/tick";

export const maxDuration = 60;

function secretsMatch(expected: string, received: string | null): boolean {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isAuthorized(request: NextRequest): {
  ok: boolean;
  method: "scheduler_secret" | "crm_api_secret" | "missing";
} {
  const schedulerSecret = process.env.PERSIA_SCHEDULER_SECRET;
  const crmApiSecret = process.env.CRM_API_SECRET;
  const bearer = request.headers.get("Authorization");
  const bearerToken =
    bearer && bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : null;

  if (
    schedulerSecret &&
    secretsMatch(
      schedulerSecret,
      request.headers.get("X-Persia-Scheduler-Secret"),
    )
  ) {
    return { ok: true, method: "scheduler_secret" };
  }

  if (crmApiSecret && secretsMatch(crmApiSecret, bearerToken)) {
    return { ok: true, method: "crm_api_secret" };
  }

  return { ok: false, method: "missing" };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const hasSchedulerSecret = Boolean(process.env.PERSIA_SCHEDULER_SECRET);
  const hasCrmApiSecret = Boolean(process.env.CRM_API_SECRET);

  if (!hasSchedulerSecret && !hasCrmApiSecret) {
    logWarn("ai_agent_scheduler_secret_missing", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/scheduler/tick",
    });
    return NextResponse.json(
      { ok: false, error: "scheduler_secret_missing" },
      { status: 503 },
    );
  }

  const auth = isAuthorized(request);
  if (!auth.ok) {
    logWarn("ai_agent_scheduler_secret_mismatch", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/scheduler/tick",
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runScheduledTick();
    logInfo("ai_agent_scheduler_tick_completed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/scheduler/tick",
      auth_method: auth.method,
      claimed_job_id: result.claimed_job_id,
      processed_jobs: result.processed_jobs,
      failed_jobs: result.failed_jobs,
      leads_processed: result.leads_processed,
      leads_skipped: result.leads_skipped,
      errors: result.errors,
    });
    return NextResponse.json(result);
  } catch (error) {
    logError("ai_agent_scheduler_tick_failed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/scheduler/tick",
      error: errorMessage(error),
    });
    return NextResponse.json(
      {
        claimed_job_id: null,
        job_id: "",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        leads_matched: 0,
        leads_processed: 0,
        leads_skipped: 0,
        errors: 1,
        error_samples: [],
        processed_jobs: 0,
        failed_jobs: 1,
        next_run_at: null,
      },
      { status: 200 },
    );
  }
}
