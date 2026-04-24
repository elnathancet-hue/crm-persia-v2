import { NextRequest, NextResponse } from "next/server";
import type { TesterRequest } from "@persia/shared/ai-agent";
import { errorMessage, getRequestId, logError } from "@/lib/observability";
import { testAgent, testAgentForOrg } from "@/actions/ai-agent/tester";
import { createAdminClient } from "@/lib/supabase/admin";
import { asAgentDb } from "@/lib/ai-agent/db";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  try {
    const body = await request.json() as TesterRequest & { org_id?: string };
    const authHeader = request.headers.get("authorization");
    const apiSecret = process.env.CRM_API_SECRET;

    const result =
      apiSecret && authHeader === `Bearer ${apiSecret}` && body.org_id
        ? await testAgentForOrg(
            body.org_id,
            { ...body, dry_run: true },
            asAgentDb(createAdminClient()),
          )
        : await testAgent({ ...body, dry_run: true });
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

