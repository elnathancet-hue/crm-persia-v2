"use server";

// Cookie de "impersonacao" do superadmin no CRM cliente.
//
// Quando um superadmin (profiles.is_superadmin = true) loga no CRM
// cliente, ele pode escolher uma organizacao pra "agir como" via o
// menu de troca de contexto. Esse cookie assina o orgId escolhido com
// HMAC + bind no fingerprint da sessao Supabase, igual o `admin-context`
// do antigo apps/admin/.
//
// Sistema unificado (Fase 1 da migracao "sistema unico"): substitui o
// admin standalone — superadmin vai usar o CRM cliente direto.
//
// SECRET: reusa `ADMIN_CONTEXT_SECRET` pra simplificar transicao.
// COOKIE_NAME: `superadmin-context` (diferente do `admin-context` do
// apps/admin pra evitar colisao durante a migracao).

import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "superadmin-context";
const TTL_HOURS = 8;
const CURRENT_VERSION = 2;
const ACCEPTED_VERSIONS = [1, 2] as const;

function getSecrets(): { active: Buffer; previous: Buffer | null } {
  const active =
    process.env.CRM_SUPERADMIN_CONTEXT_SECRET ||
    process.env.ADMIN_CONTEXT_SECRET;
  if (!active) {
    throw new Error(
      "CRM_SUPERADMIN_CONTEXT_SECRET (ou ADMIN_CONTEXT_SECRET) nao esta definido. " +
        "Gere com: openssl rand -hex 32 e adicione no .env.local",
    );
  }
  const previous =
    process.env.CRM_SUPERADMIN_CONTEXT_SECRET_PREVIOUS ||
    process.env.ADMIN_CONTEXT_SECRET_PREVIOUS ||
    null;
  return {
    active: Buffer.from(active, "utf8"),
    previous: previous ? Buffer.from(previous, "utf8") : null,
  };
}

/**
 * Fingerprint da sessao Supabase pra binding do cookie. Mesma logica
 * do antigo apps/admin/src/lib/admin-context.ts.
 */
async function deriveSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const authCookies = cookieStore
    .getAll()
    .filter((c) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join("");

  if (!authCookies) return null;

  return crypto
    .createHash("sha256")
    .update(authCookies)
    .digest("hex")
    .slice(0, 16);
}

interface SuperadminContextPayloadV1 {
  orgId: string;
  userId: string;
  iat: number;
  exp: number;
  v: 1;
}

interface SuperadminContextPayloadV2 {
  orgId: string;
  userId: string;
  sid: string;
  iat: number;
  exp: number;
  v: 2;
}

type SuperadminContextPayload =
  | SuperadminContextPayloadV1
  | SuperadminContextPayloadV2;

function signWith(secret: Buffer, payload: SuperadminContextPayload): string {
  const data = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", secret).update(data).digest("hex");
  const encoded = Buffer.from(data).toString("base64url");
  return `${encoded}.${hmac}`;
}

function tryVerify(
  secret: Buffer,
  encoded: string,
  hmac: string,
): SuperadminContextPayload | null {
  try {
    if (!/^[a-f0-9]{64}$/.test(hmac)) return null;
    const data = Buffer.from(encoded, "base64url").toString("utf8");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("hex");
    if (
      !crypto.timingSafeEqual(
        Buffer.from(hmac, "hex"),
        Buffer.from(expected, "hex"),
      )
    ) {
      return null;
    }

    const payload = JSON.parse(data) as SuperadminContextPayload;

    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.orgId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.v !== "number"
    ) {
      return null;
    }

    if (!ACCEPTED_VERSIONS.includes(payload.v as 1 | 2)) return null;
    if (
      payload.v === 2 &&
      typeof (payload as SuperadminContextPayloadV2).sid !== "string"
    ) {
      return null;
    }
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

function verify(token: string): SuperadminContextPayload | null {
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null;

  const encoded = token.substring(0, dotIndex);
  const hmac = token.substring(dotIndex + 1);

  const { active, previous } = getSecrets();

  const fromActive = tryVerify(active, encoded, hmac);
  if (fromActive) return fromActive;
  if (previous) {
    const fromPrevious = tryVerify(previous, encoded, hmac);
    if (fromPrevious) {
      console.warn(
        "[superadmin-context] cookie verified com secret PREVIOUS — rotacao em curso",
      );
      return fromPrevious;
    }
  }
  return null;
}

/**
 * Seta o cookie de impersonacao. Chamar apos auth + checagem de
 * is_superadmin + validação que org existe.
 */
export async function setSuperadminContext(
  orgId: string,
  userId: string,
): Promise<void> {
  const sid = await deriveSessionId();
  const now = Date.now();

  const payload: SuperadminContextPayload = sid
    ? {
        orgId,
        userId,
        sid,
        iat: now,
        exp: now + TTL_HOURS * 60 * 60 * 1000,
        v: 2,
      }
    : {
        orgId,
        userId,
        iat: now,
        exp: now + TTL_HOURS * 60 * 60 * 1000,
        v: 1,
      };

  if (!sid) {
    console.warn(
      "[superadmin-context] sem cookies sb-*-auth-token — emitindo v1 (sem sid)",
    );
  }

  const { active } = getSecrets();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, signWith(active, payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: TTL_HOURS * 60 * 60,
    priority: "high",
  });
}

/** Limpa o cookie — superadmin "volta" pra visualizacao global. */
export async function clearSuperadminContext(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Le e verifica o cookie de impersonacao.
 * Retorna `{ orgId, userId }` validados OU null se nao tem / expirou /
 * sid mismatch (v2 only).
 *
 * Caller deve confirmar que `payload.userId` bate com a sessao atual.
 */
export async function readSuperadminContext(): Promise<{
  orgId: string;
  userId: string;
} | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;

  const payload = verify(cookie.value);
  if (!payload) return null;

  if (payload.v === 2) {
    const sid = await deriveSessionId();
    if (!sid || sid !== payload.sid) {
      console.warn(
        "[superadmin-context] sid mismatch — cookie rejeitado",
      );
      return null;
    }
  } else {
    console.warn(
      "[superadmin-context] cookie v1 aceito (sem sid). Sera re-emitido como v2 na proxima troca.",
    );
  }

  return { orgId: payload.orgId, userId: payload.userId };
}

/**
 * Re-emite v1 como v2 (mesmo padrao do antigo `maybeUpgradeCookie`).
 * Best-effort.
 */
export async function maybeUpgradeSuperadminCookie(): Promise<void> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return;

  const payload = verify(cookie.value);
  if (!payload || payload.v === CURRENT_VERSION) return;

  await setSuperadminContext(payload.orgId, payload.userId);
}
