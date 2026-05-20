// Google Calendar — API client.
//
// PR-FLOW-PIVOT PR 14a (mai/2026): wrapper sobre a Google Calendar
// REST API v3. V1 cobre:
//   - listCalendars(): lista calendars do usuário conectado
//   - fetchUserEmail(): pega email da conta (display name)
//
// Token refresh é AUTOMATIC nas funções públicas — se access_token
// está expirado ou prestes a expirar (<60s buffer), usa refresh_token
// pra renovar + persiste em google_calendar_connections.
//
// Future PRs:
//   - PR 14b: createEvent, updateEvent, deleteEvent
//   - PR 14c: list events (sync)
//   - PR 14d: webhooks (push notifications)

import { refreshAccessToken } from "./oauth";

const GOOGLE_API_BASE = "https://www.googleapis.com";
const TOKEN_REFRESH_BUFFER_SECONDS = 60; // renew se faltar <60s

// ============================================================================
// Connection record (espelho do DB row)
// ============================================================================

export interface GoogleCalendarConnection {
  organization_id: string;
  google_account_email: string;
  refresh_token: string;
  access_token: string;
  access_token_expires_at: string; // ISO timestamp
  default_calendar_id: string | null;
  calendar_list: GoogleCalendarSummary[];
  scope: string;
  is_active: boolean;
}

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
  accessRole?: string;
  backgroundColor?: string;
}

// ============================================================================
// Minimal DB interface — duck-typed pra ser flexible com diferentes clients
// ============================================================================

export interface MinimalDb {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ============================================================================
// Token refresh + persist
// ============================================================================

/**
 * Retorna um access_token válido. Se o atual expirou (ou expira em
 * <60s), usa refresh_token pra pegar novo + persiste no DB.
 *
 * Caller passa o `db` pra persistir o novo token. Throw se refresh
 * falhar — caller decide (UI mostra "reconecte conta Google").
 */
export async function getValidAccessToken(
  db: MinimalDb,
  conn: GoogleCalendarConnection,
): Promise<string> {
  const expiresAtMs = new Date(conn.access_token_expires_at).getTime();
  const nowMs = Date.now();
  const bufferMs = TOKEN_REFRESH_BUFFER_SECONDS * 1000;

  if (expiresAtMs - nowMs > bufferMs) {
    // Token ainda válido com folga.
    return conn.access_token;
  }

  // Refresha + persiste.
  const refreshed = await refreshAccessToken(conn.refresh_token);
  const newExpiresAt = new Date(
    Date.now() + refreshed.expires_in * 1000,
  ).toISOString();

  const { error } = await db
    .from("google_calendar_connections")
    .update({
      access_token: refreshed.access_token,
      access_token_expires_at: newExpiresAt,
    })
    .eq("organization_id", conn.organization_id);
  if (error) {
    // Persist falhou mas temos o token em memória — ainda dá pra usar
    // nessa request. Log + segue.
    console.error(
      "[google-calendar] persist refreshed access_token failed:",
      error.message,
    );
  }

  return refreshed.access_token;
}

// ============================================================================
// Public API helpers
// ============================================================================

/**
 * Lista calendars do usuário conectado. Retorna shape compacto pra
 * cachear em `calendar_list` JSONB.
 */
export async function listCalendars(
  db: MinimalDb,
  conn: GoogleCalendarConnection,
): Promise<GoogleCalendarSummary[]> {
  const accessToken = await getValidAccessToken(db, conn);

  const res = await fetch(
    `${GOOGLE_API_BASE}/calendar/v3/users/me/calendarList?maxResults=50&minAccessRole=writer`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google calendarList falhou (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      primary?: boolean;
      timeZone?: string;
      accessRole?: string;
      backgroundColor?: string;
    }>;
  };

  return (json.items ?? [])
    .filter((c) => typeof c.id === "string")
    .map((c) => ({
      id: c.id,
      summary: c.summary ?? c.id,
      primary: Boolean(c.primary),
      timeZone: c.timeZone,
      accessRole: c.accessRole,
      backgroundColor: c.backgroundColor,
    }));
}

/**
 * Pega o email da conta autenticada (usado no OAuth callback pra
 * salvar `google_account_email`).
 */
export async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(
    `${GOOGLE_API_BASE}/oauth2/v2/userinfo?fields=email`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google userinfo falhou (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { email?: string };
  if (!json.email) {
    throw new Error("userinfo sem campo email");
  }
  return json.email;
}
