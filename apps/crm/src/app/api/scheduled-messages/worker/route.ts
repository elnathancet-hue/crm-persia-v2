// POST /api/scheduled-messages/worker — processa mensagens agendadas do chat.
// Protegido pelos mesmos secrets usados nos workers de campanhas/scheduler.

import { NextResponse } from "next/server";
import { processScheduledMessages } from "@/lib/whatsapp/send-scheduled-worker";

function isAuthorized(req: Request): boolean {
  const bearer = req.headers.get("authorization");
  const cronSecret = req.headers.get("x-cron-secret");
  const schedulerSecret = req.headers.get("x-persia-scheduler-secret");
  const expectedSecrets = [
    process.env.CRON_SECRET,
    process.env.SCHEDULER_TICK_SECRET,
  ].filter((secret): secret is string => Boolean(secret));

  return Boolean(
    expectedSecrets.length > 0 &&
      expectedSecrets.some(
        (expected) =>
          bearer === `Bearer ${expected}` ||
          cronSecret === expected ||
          schedulerSecret === expected,
      ),
  );
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processScheduledMessages();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
