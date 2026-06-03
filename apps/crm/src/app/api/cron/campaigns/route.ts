import { NextRequest, NextResponse } from "next/server";
import { processDueCampaignJobs } from "@/lib/campaigns/worker";

/**
 * GET /api/cron/campaigns
 * Cron endpoint que processa jobs de campanha vencidos.
 * Deve ser chamado a cada 1 minuto pelo n8n ou EasyPanel.
 * Auth: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await processDueCampaignJobs({
      limit: 100,
      workerId: `cron-${Date.now()}`,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
