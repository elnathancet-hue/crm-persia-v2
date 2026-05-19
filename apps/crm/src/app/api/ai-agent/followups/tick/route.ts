import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  errorMessage,
  getRequestId,
  logError,
  logInfo,
  logWarn,
} from "@/lib/observability";
import { runFollowupsTick } from "@/lib/ai-agent/followups/tick";

// PR4 (mai/2026): endpoint cron pro runtime de agent_followups. Espelha
// o /api/ai-agent/scheduler/tick em estrutura e auth — mesmo padrao de
// secrets (PERSIA_SCHEDULER_SECRET via header X-Persia-Scheduler-Secret,
// ou CRM_API_SECRET via Bearer Authorization).
//
// EXPECTATIVA DE CRON: 1 disparo a cada 5-15min em prod. Limite de 200
// conversas por tick (vide MAX_PROCESSED_PER_TICK em tick.ts) — em
// escala, configurar tick mais frequente em vez de processar maior
// batch (evita timeout do route).
//
// EasyPanel cron command (exemplo, a cada 10min):
//   curl -X POST https://crm.funilpersia.top/api/ai-agent/followups/tick \
//        -H "X-Persia-Scheduler-Secret: $PERSIA_SCHEDULER_SECRET"
//   (ou Bearer $CRM_API_SECRET via Authorization)

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
    logWarn("ai_agent_followups_tick_secret_missing", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/followups/tick",
    });
    return NextResponse.json(
      { ok: false, error: "scheduler_secret_missing" },
      { status: 503 },
    );
  }

  const auth = isAuthorized(request);
  if (!auth.ok) {
    logWarn("ai_agent_followups_tick_secret_mismatch", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/followups/tick",
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runFollowupsTick();
    logInfo("ai_agent_followups_tick_route_completed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/followups/tick",
      auth_method: auth.method,
      followups_loaded: result.followups_loaded,
      conversations_matched: result.conversations_matched,
      fired: result.fired,
      skipped: result.skipped,
      errors: result.errors,
    });
    return NextResponse.json(result);
  } catch (error) {
    logError("ai_agent_followups_tick_route_failed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/followups/tick",
      error: errorMessage(error),
    });
    return NextResponse.json(
      {
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        followups_loaded: 0,
        conversations_matched: 0,
        fired: 0,
        skipped: 0,
        errors: 1,
        error_samples: [],
      },
      { status: 200 },
    );
  }
}
