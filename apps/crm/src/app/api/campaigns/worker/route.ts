// POST /api/campaigns/worker — invoca o worker de jobs de campanha.
// Protegido por CRON_SECRET (mesmo padrão dos outros routes de cron).

import { NextResponse } from "next/server";
import { processDueCampaignJobs } from "@/lib/campaigns/worker";

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDueCampaignJobs({
      limit: 100,
      workerId: `cron-${Date.now()}`,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
