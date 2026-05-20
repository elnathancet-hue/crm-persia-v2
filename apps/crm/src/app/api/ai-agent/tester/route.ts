import { NextRequest, NextResponse } from "next/server";
import { errorMessage, getRequestId, logError } from "@/lib/observability";
import { testAgent } from "@/actions/ai-agent/tester";

// PR-FLOW-PIVOT PR 2 (mai/2026): rota de Tester restaurada. Chama o
// novo runtime via `testAgent` (server action). Auth = user session
// (requireAgentRole por baixo). PR 2b vai adicionar caminho admin via
// API_SECRET pra orgs externas.

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers);
  try {
    const body = await request.json();
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
