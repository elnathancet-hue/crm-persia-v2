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
import { runFollowupsTick } from "@/lib/ai-agent/followups/tick";
import { processFollowUps } from "@/lib/flows/followup";
import { processScheduledMessages, processScheduledGroupMessages } from "@/lib/whatsapp/send-scheduled-worker";
import { processDueCampaignJobs } from "@/lib/campaigns/worker";
import { runRemindersTick } from "@/lib/agenda/reminders/dispatch";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [followups, agentFollowups, scheduled, scheduledGroups, campaigns, reminders] = await Promise.allSettled([
    processFollowUps(),
    runFollowupsTick(),
    processScheduledMessages(),
    processScheduledGroupMessages(),
    processDueCampaignJobs({ limit: 100, workerId: `cron-all-${Date.now()}` }),
    runRemindersTick(),
  ]);

  return NextResponse.json({
    ok: true,
    followups: followups.status === "fulfilled"
      ? followups.value
      : { error: (followups.reason instanceof Error ? followups.reason.message : String(followups.reason)) },
    agent_followups: agentFollowups.status === "fulfilled"
      ? agentFollowups.value
      : { error: (agentFollowups.reason instanceof Error ? agentFollowups.reason.message : String(agentFollowups.reason)) },
    scheduled: scheduled.status === "fulfilled"
      ? scheduled.value
      : { error: (scheduled.reason instanceof Error ? scheduled.reason.message : String(scheduled.reason)) },
    scheduled_groups: scheduledGroups.status === "fulfilled"
      ? scheduledGroups.value
      : { error: (scheduledGroups.reason instanceof Error ? scheduledGroups.reason.message : String(scheduledGroups.reason)) },
    campaigns: campaigns.status === "fulfilled"
      ? campaigns.value
      : { error: (campaigns.reason instanceof Error ? campaigns.reason.message : String(campaigns.reason)) },
    reminders: reminders.status === "fulfilled"
      ? reminders.value
      : { error: (reminders.reason instanceof Error ? reminders.reason.message : String(reminders.reason)) },
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
