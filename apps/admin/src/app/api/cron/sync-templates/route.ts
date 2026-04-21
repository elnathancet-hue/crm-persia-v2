import { NextRequest, NextResponse } from "next/server";
import { syncAllMetaTemplatesForCron } from "@/actions/templates";

/**
 * Cron: sincroniza templates Meta para todas as orgs com conexao meta_cloud
 * conectada. Recomendado rodar a cada 30 min.
 *
 * EasyPanel cron job:
 *   curl -sS -H "Authorization: Bearer $CRON_SECRET" \
 *        "$ADMIN_URL/api/cron/sync-templates"
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await syncAllMetaTemplatesForCron();
  return NextResponse.json({ ok: true, ...summary, timestamp: new Date().toISOString() });
}
