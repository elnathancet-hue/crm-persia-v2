import { NextRequest, NextResponse } from "next/server";
import { processFollowUps } from "@/lib/flows/followup";

/**
 * GET /api/cron/followups
 * Cron endpoint that processes scheduled follow-ups (paused wait nodes).
 * Auth: Bearer CRON_SECRET (same pattern as send-scheduled)
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (same pattern as /api/cron/send-scheduled)
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await processFollowUps();

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Cron:FollowUps] Error:", msg);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
