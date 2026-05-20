// Google Calendar OAuth — callback.
//
// PR-FLOW-PIVOT PR 14a (mai/2026): segunda metade do OAuth flow.
// Google redireciona aqui com `code` + `state`. Verificamos state
// (CSRF + age), trocamos code por tokens, pegamos email da conta,
// listamos calendars, e UPSERTamos a row em
// `google_calendar_connections`.
//
// Redireciona pra /settings/google-calendar no fim (com query
// ?status=ok/error pra UI mostrar toast).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { errorMessage, logError } from "@/lib/observability";
import { createClient } from "@supabase/supabase-js";
import { asAgentDb } from "@/lib/ai-agent/db";
import {
  exchangeCodeForTokens,
  GOOGLE_OAUTH_SCOPES,
  verifyOAuthState,
} from "@/lib/google-calendar/oauth";
import {
  fetchUserEmail,
  listCalendars,
  type GoogleCalendarConnection,
} from "@/lib/google-calendar/api";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function redirectWithStatus(
  origin: string,
  status: "ok" | "error",
  message?: string,
): NextResponse {
  const url = new URL("/settings/google-calendar", origin);
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("msg", message.slice(0, 200));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);

  // 1. Google pode redirecionar com `error=access_denied` se usuário
  // recusou. Trata gracioso.
  const googleError = searchParams.get("error");
  if (googleError) {
    return redirectWithStatus(origin, "error", `Google: ${googleError}`);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    return redirectWithStatus(origin, "error", "Faltou code/state no callback.");
  }

  // 2. Verifica state (CSRF + age).
  const stateCheck = verifyOAuthState(state);
  if (!stateCheck.ok) {
    logError("google_oauth_callback_invalid_state", { error: stateCheck.error });
    return redirectWithStatus(
      origin,
      "error",
      `State inválido (${stateCheck.error}). Tente conectar novamente.`,
    );
  }
  const { orgId, userId } = stateCheck.payload;

  try {
    // 3. Troca code por tokens.
    const tokens = await exchangeCodeForTokens(code);

    // 4. Pega email da conta.
    const accountEmail = await fetchUserEmail(tokens.access_token);

    // 5. UPSERT inicial — precisamos da conn salva pra listCalendars
    // poder refrescar token se preciso (improvável aqui — token é novo
    // — mas API espera assinatura consistente).
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();
    const sb = asAgentDb(getServiceClient());
    const conn: GoogleCalendarConnection = {
      organization_id: orgId,
      google_account_email: accountEmail,
      refresh_token: tokens.refresh_token!,
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
      default_calendar_id: null,
      calendar_list: [],
      scope: tokens.scope || GOOGLE_OAUTH_SCOPES.join(" "),
      is_active: true,
    };

    // 6. Lista calendars (com o access_token novo).
    let calendars: typeof conn.calendar_list = [];
    try {
      calendars = await listCalendars(sb, conn);
    } catch (err) {
      // Se listar falhar, salva conn assim mesmo + lista vazia. Usuário
      // pode clicar "Atualizar lista" depois.
      logError("google_oauth_callback_list_calendars_failed", {
        organization_id: orgId,
        error: errorMessage(err),
      });
    }

    // Auto-pick: se tem 1 só, ou se tem "primary", define como default.
    let defaultCalendarId: string | null = null;
    if (calendars.length === 1) {
      defaultCalendarId = calendars[0].id;
    } else {
      const primary = calendars.find((c) => c.primary);
      if (primary) defaultCalendarId = primary.id;
    }

    // 7. UPSERT final com calendar_list + default.
    const { error: upsertErr } = await sb
      .from("google_calendar_connections")
      .upsert(
        {
          organization_id: orgId,
          google_account_email: accountEmail,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          access_token_expires_at: expiresAt,
          calendar_list: calendars,
          default_calendar_id: defaultCalendarId,
          scope: tokens.scope || GOOGLE_OAUTH_SCOPES.join(" "),
          is_active: true,
          connected_by_user_id: userId,
        },
        { onConflict: "organization_id" },
      );

    if (upsertErr) {
      logError("google_oauth_callback_upsert_failed", {
        organization_id: orgId,
        error: upsertErr.message,
      });
      return redirectWithStatus(
        origin,
        "error",
        "Falha ao salvar conexão. Tente novamente.",
      );
    }

    return redirectWithStatus(origin, "ok");
  } catch (err) {
    logError("google_oauth_callback_unhandled", {
      organization_id: orgId,
      error: errorMessage(err),
    });
    return redirectWithStatus(origin, "error", errorMessage(err));
  }
}
