import { NextRequest, NextResponse } from "next/server";
import type { TesterRequest } from "@persia/shared/ai-agent";
import { errorMessage, getRequestId, logError } from "@/lib/observability";
import { testAgent } from "@/actions/ai-agent/tester";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  try {
    const body = await request.json() as TesterRequest;
    const result = await testAgent({ ...body, dry_run: true });
    return NextResponse.json(result);
  } catch (error) {
    logError("ai_agent_tester_failed", {
      organization_id: null,
      request_id: requestId,
      error: errorMessage(error),
    });
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 400 },
    );
  }
}

