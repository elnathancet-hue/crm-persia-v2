import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runRemindersTick } from "@/lib/agenda/reminders/dispatch";

export const maxDuration = 60;

function secretsMatch(expected: string, received: string | null): boolean {
  if (!received) return false;
  const e = Buffer.from(expected);
  const r = Buffer.from(received);
  if (e.length !== r.length) return false;
  return timingSafeEqual(e, r);
}

function isAuthorized(request: NextRequest): boolean {
  const schedulerSecret = process.env.PERSIA_SCHEDULER_SECRET;
  const crmApiSecret = process.env.CRM_API_SECRET;

  if (
    schedulerSecret &&
    secretsMatch(
      schedulerSecret,
      request.headers.get("X-Persia-Scheduler-Secret"),
    )
  ) {
    return true;
  }

  const bearer = request.headers.get("Authorization");
  const bearerToken =
    bearer && bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : null;
  if (crmApiSecret && secretsMatch(crmApiSecret, bearerToken)) {
    return true;
  }

  return false;
}

export async function POST(request: NextRequest) {
  if (!process.env.PERSIA_SCHEDULER_SECRET && !process.env.CRM_API_SECRET) {
    return NextResponse.json(
      { ok: false, error: "scheduler_secret_missing" },
      { status: 503 },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await runRemindersTick();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
