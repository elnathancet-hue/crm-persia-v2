import { NextRequest, NextResponse } from "next/server";
import { processScheduledMessages } from "@/lib/whatsapp/send-scheduled-worker";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await processScheduledMessages();
  return NextResponse.json({ ok: true, ...result });
}
