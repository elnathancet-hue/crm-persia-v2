import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequestId, logError, logInfo, logWarn, errorMessage } from "@/lib/observability";
import { flushReadyConversations } from "@/lib/ai-agent/debounce";
import { asAgentDb } from "@/lib/ai-agent/db";
import { createAdminClient } from "@/lib/supabase/admin";

function secretsMatch(expected: string, received: string | null): boolean {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  const expectedSecret = process.env.PERSIA_DEBOUNCE_FLUSH_SECRET;

  if (!expectedSecret) {
    logWarn("ai_agent_debounce_flush_secret_missing", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
    });
    return NextResponse.json({ ok: false, error: "flush_secret_missing" }, { status: 503 });
  }

  if (!secretsMatch(expectedSecret, request.headers.get("X-Persia-Cron-Secret"))) {
    logWarn("ai_agent_debounce_flush_secret_mismatch", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
    });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await flushReadyConversations({
      db: asAgentDb(createAdminClient()),
      requestId,
    });

    logInfo("ai_agent_debounce_flush_completed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
      flushed_conversations: result.flushed_conversations,
      runs_created: result.runs_created,
      errors: result.errors,
    });

    return NextResponse.json(result);
  } catch (error) {
    logError("ai_agent_debounce_flush_failed", {
      organization_id: null,
      request_id: requestId,
      route: "/api/ai-agent/debounce-flush",
      error: errorMessage(error),
    });
    return NextResponse.json(
      {
        flushed_conversations: 0,
        runs_created: 0,
        errors: 1,
        details: [],
      },
      { status: 200 },
    );
  }
}
