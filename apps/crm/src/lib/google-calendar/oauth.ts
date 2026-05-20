// Google Calendar — OAuth 2.0 helpers.
//
// PR-FLOW-PIVOT PR 14a (mai/2026): foundation pra integração Google
// Calendar. Esse módulo só lida com OAuth: gera URL de consent,
// troca code por tokens, refresha access_token expirado.
//
// API client (listar calendars, criar event) fica em `./api.ts`.
//
// Env vars necessárias:
//   - GOOGLE_OAUTH_CLIENT_ID    — Client ID do Google Cloud Console
//   - GOOGLE_OAUTH_CLIENT_SECRET
//   - GOOGLE_OAUTH_REDIRECT_URI — ex: https://crm.funilpersia.top/api/oauth/google/callback
//
// Quando ENV vars não configuradas, throw amigável que UI mostra como
// "configure no servidor". Não quebra build/dev (server actions
// detectam erro e retornam mensagem clara).

// Escopo mínimo necessário pra V1:
//   - calendar.events: criar/atualizar/listar eventos
//   - calendar.readonly: listar calendars do usuário
//   - userinfo.email: pegar email da conta conectada (display)
//
// V2 pode adicionar `calendar` (full) se precisar criar calendars
// novos ou gerenciar settings.
export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Lê env vars + valida. Throw se faltar — server action captura e
 * mostra "configure ... no servidor".
 */
export function getGoogleOAuthEnv(): GoogleOAuthEnv {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google Calendar não configurado — defina GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REDIRECT_URI no servidor.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Constrói URL de consent screen do Google. `state` é o opaque token
 * que o callback verifica — caller deve gerar (assinado) e armazenar
 * em cookie HttpOnly antes de redirecionar.
 *
 * access_type=offline garante que o Google retorne refresh_token
 * (precisamos pra renovar access_token sem reconectar).
 *
 * prompt=consent força o consent screen mesmo se já autorizou antes,
 * garantindo que o refresh_token venha (sem prompt, Google pode
 * skipar consent e NÃO devolver refresh_token).
 */
export function buildGoogleConsentUrl(params: {
  state: string;
  loginHint?: string; // email opcional pra pré-preencher
}): string {
  const env = getGoogleOAuthEnv();
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
  return url.toString();
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string; // omitido em refresh-renewal (só vem na 1ª)
  expires_in: number; // segundos
  scope: string;
  token_type: "Bearer";
  id_token?: string;
}

/**
 * Troca authorization code por tokens (1ª fase do OAuth, após
 * redirect do consent screen).
 */
export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const env = getGoogleOAuthEnv();
  const body = new URLSearchParams({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google token exchange falhou (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as GoogleTokenResponse;
  if (!json.access_token || !json.refresh_token) {
    throw new Error(
      "Resposta do Google sem access_token ou refresh_token — reautorize garantindo `prompt=consent` + `access_type=offline`.",
    );
  }
  return json;
}

/**
 * Refresh do access_token usando refresh_token. Google só devolve
 * access_token novo + expires_in — refresh_token original continua
 * válido.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const env = getGoogleOAuthEnv();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google token refresh falhou (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || typeof json.expires_in !== "number") {
    throw new Error("Resposta de refresh sem access_token ou expires_in.");
  }
  return { access_token: json.access_token, expires_in: json.expires_in };
}

// ============================================================================
// State token (CSRF protection)
// ============================================================================
//
// Strategy V1: HMAC-SHA256 de { orgId, userId, nonce, expiresAt }
// codificado em base64url. Verificável no callback sem DB lookup.
//
// Secret: reusa ADMIN_CONTEXT_SECRET (já existe no env, 32+ bytes).
// V2 pode mudar pra GOOGLE_OAUTH_STATE_SECRET dedicado.

import crypto from "node:crypto";

interface OAuthStatePayload {
  orgId: string;
  userId: string;
  nonce: string;
  expiresAt: number; // epoch seconds
}

const STATE_TTL_SECONDS = 600; // 10 min

function getStateSecret(): string {
  const secret = process.env.ADMIN_CONTEXT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "ADMIN_CONTEXT_SECRET ausente ou curto — defina 32+ bytes no servidor pra assinar state OAuth.",
    );
  }
  return secret;
}

export function signOAuthState(orgId: string, userId: string): string {
  const payload: OAuthStatePayload = {
    orgId,
    userId,
    nonce: crypto.randomBytes(16).toString("hex"),
    expiresAt: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = crypto
    .createHmac("sha256", getStateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(
  state: string,
): { ok: true; payload: OAuthStatePayload } | { ok: false; error: string } {
  const parts = state.split(".");
  if (parts.length !== 2) return { ok: false, error: "state_malformed" };
  const [body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", getStateSecret())
    .update(body)
    .digest("base64url");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return { ok: false, error: "state_signature_invalid" };
  }
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "state_payload_invalid" };
  }
  if (typeof payload.expiresAt !== "number") {
    return { ok: false, error: "state_payload_missing_expiry" };
  }
  if (Math.floor(Date.now() / 1000) > payload.expiresAt) {
    return { ok: false, error: "state_expired" };
  }
  return { ok: true, payload };
}
