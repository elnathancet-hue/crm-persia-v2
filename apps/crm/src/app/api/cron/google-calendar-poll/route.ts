// Google Calendar — pull sync endpoint (chamado por pg_cron a cada 5min).
//
// PR-FLOW-PIVOT PR 14c (mai/2026): endpoint protegido por bearer
// header `X-Persia-Gcal-Poll-Secret`. Cron (migration 061) chama
// fire-and-forget; falha silenciosa por org (logs em observability).
//
// NÃO autenticado via session — cron não tem user logado. Auth via
// secret compartilhado entre EasyPanel env (PERSIA_GCAL_POLL_SECRET)
// e DB setting (app.settings.gcal_poll_secret).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { errorMessage, logError } from "@/lib/observability";
import { pollAllOrgs } from "@/lib/google-calendar/sync";

function authorize(request: NextRequest): boolean {
  const expected = process.env.PERSIA_GCAL_POLL_SECRET;
  if (!expected) {
    // Sem secret no servidor — endpoint desabilitado por segurança.
    // (Diferente de 401: 503 sinaliza pro cron "config ausente, não tente".)
    return false;
  }
  const headerSecret = request.headers.get("x-persia-gcal-poll-secret");
  if (!headerSecret) return false;
  // Comparação simples — ambos sabem o valor, não há timing attack
  // significativo aqui (env vars do EasyPanel, cron via pg_net).
  return headerSecret === expected;
}

export async function POST(request: NextRequest) {
  if (!process.env.PERSIA_GCAL_POLL_SECRET) {
    return NextResponse.json(
      { ok: false, error: "PERSIA_GCAL_POLL_SECRET não configurada no servidor" },
      { status: 503 },
    );
  }
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await pollAllOrgs();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    logError("gcal_poll_endpoint_unhandled", { error: errorMessage(err) });
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 },
    );
  }
}

// GET também aceito pra debug manual com curl (admin pode disparar).
export async function GET(request: NextRequest) {
  return POST(request);
}
