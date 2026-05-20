// Google Calendar OAuth — initiate.
//
// PR-FLOW-PIVOT PR 14a (mai/2026): primeira metade do OAuth flow.
// Cliente clica "Conectar Google Calendar" na UI → redireciona aqui →
// assinamos um state token (CSRF) + redirecionamos pro consent screen
// do Google.
//
// State signature: HMAC-SHA256 com ADMIN_CONTEXT_SECRET. Verificável
// no callback sem DB lookup.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { errorMessage, logError } from "@/lib/observability";
import {
  buildGoogleConsentUrl,
  signOAuthState,
} from "@/lib/google-calendar/oauth";

export async function GET(_request: NextRequest) {
  try {
    // Apenas admin/owner pode conectar (config de org).
    const { orgId, userId } = await requireRole("admin");

    const state = signOAuthState(orgId, userId);
    const consentUrl = buildGoogleConsentUrl({ state });

    return NextResponse.redirect(consentUrl);
  } catch (err) {
    logError("google_oauth_connect_failed", { error: errorMessage(err) });
    // Server actions já mostram a mensagem na UI; se o usuário chegou
    // aqui via URL direta, devolvemos texto simples.
    return new NextResponse(
      `Falha ao iniciar OAuth Google: ${errorMessage(err)}`,
      { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
}
