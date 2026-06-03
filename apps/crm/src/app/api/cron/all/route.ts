// GET /api/cron/all — cron global que dispara todos os workers em paralelo.
//
// Auth: Bearer CRON_SECRET (mesmo dos outros crons).
// Nota: google-calendar-poll usa PERSIA_GCAL_POLL_SECRET separado e
// tem intervalo próprio (5min via pg_cron) — não incluído aqui.
//
// Configurar 1 único job no EasyPanel/n8n:
//   GET https://crm.funilpersia.top/api/cron/all
//   Authorization: Bearer <CRON_SECRET>
//   Frequência: 1 minuto

import { NextRequest, NextResponse } from "next/server";
import { processFollowUps } from "@/lib/flows/followup";
import { processScheduledMessages } from "@/lib/whatsapp/send-scheduled-worker";
import { processDueCampaignJobs } from "@/lib/campaigns/worker";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [followups, scheduled, campaigns] = await Promise.allSettled([
    processFollowUps(),
    processScheduledMessages(),
    processDueCampaignJobs({ limit: 100, workerId: `cron-all-${Date.now()}` }),
  ]);

  return NextResponse.json({
    ok: true,
    followups: followups.status === "fulfilled"
      ? followups.value
      : { error: (followups.reason instanceof Error ? followups.reason.message : String(followups.reason)) },
    scheduled: scheduled.status === "fulfilled"
      ? scheduled.value
      : { error: (scheduled.reason instanceof Error ? scheduled.reason.message : String(scheduled.reason)) },
    campaigns: campaigns.status === "fulfilled"
      ? campaigns.value
      : { error: (campaigns.reason instanceof Error ? campaigns.reason.message : String(campaigns.reason)) },
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
