import { NextRequest, NextResponse } from "next/server";
import { resumeExecution } from "@/lib/flows/engine";

/**
 * POST /api/flows/resume
 * Resumes a paused flow execution (after a "wait" node completes).
 * Body: { executionId: string }
 * Auth: Bearer CRM_API_SECRET
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate: require Bearer token
    const authHeader = request.headers.get("authorization");
    const apiSecret = process.env.CRM_API_SECRET;
    if (!apiSecret || authHeader !== `Bearer ${apiSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { executionId } = body;

    if (!executionId) {
      return NextResponse.json(
        { ok: false, error: "executionId is required" },
        { status: 400 }
      );
    }

    await resumeExecution(executionId);

    return NextResponse.json({ ok: true, executionId });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[FlowResume] Error:", msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
