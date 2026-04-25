import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { errorMessage, getRequestId, logError, logInfo, logWarn } from "@/lib/observability";
import { runIndexingTick } from "@/lib/ai-agent/rag/indexer";

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
  method: "indexer_secret" | "crm_api_secret" | "missing";
} {
  const indexerSecret = process.env.PERSIA_INDEXER_SECRET;
  const crmApiSecret = process.env.CRM_API_SECRET;
  const bearer = request.headers.get("Authorization");
  const bearerToken =
    bearer && bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : null;

  if (indexerSecret && secretsMatch(indexerSecret, request.headers.get("X-Persia-Indexer-Secret"))) {
    return { ok: true, method: "indexer_secret" };
  }

  if (crmApiSecret && secretsMatch(crmApiSecret, bearerToken)) {
    return { ok: true, method: "crm_api_secret" };
  }

  return { ok: false, method: "missing" };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const hasIndexerSecret = Boolean(process.env.PERSIA_INDEXER_SECRET);
  const hasCrmApiSecret = Boolean(process.env.CRM_API_SECRET);

  if (!hasIndexerSecret && !hasCrmApiSecret) {
    logWarn("ai_agent_indexer_secret_missing", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/indexer/tick",
    });
    return NextResponse.json({ ok: false, error: "indexer_secret_missing" }, { status: 503 });
  }

  const auth = isAuthorized(request);
  if (!auth.ok) {
    logWarn("ai_agent_indexer_secret_mismatch", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/indexer/tick",
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runIndexingTick();
    logInfo("ai_agent_indexer_tick_completed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/indexer/tick",
      auth_method: auth.method,
      claimed_job_id: result.claimed_job_id,
      processed_jobs: result.processed_jobs,
      indexed_sources: result.indexed_sources,
      failed_jobs: result.failed_jobs,
    });
    return NextResponse.json(result);
  } catch (error) {
    logError("ai_agent_indexer_tick_failed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/indexer/tick",
      error: errorMessage(error),
    });
    return NextResponse.json(
      {
        claimed_job_id: null,
        processed_jobs: 0,
        indexed_sources: 0,
        failed_jobs: 1,
        details: [],
      },
      { status: 200 },
    );
  }
}
