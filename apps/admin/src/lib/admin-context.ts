"use server";

import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "admin-context";
const TTL_HOURS = 8;
const CURRENT_VERSION = 2;
const ACCEPTED_VERSIONS = [1, 2] as const;

/**
 * Returns the active and (optional) previous secrets used to sign/verify
 * the admin context cookie. Both secrets are tried during verify so a
 * rotated secret doesn't invalidate every active session.
 *
 * - ADMIN_CONTEXT_SECRET             active (used for signing)
 * - ADMIN_CONTEXT_SECRET_PREVIOUS    optional, accepted during verify only
 *
 * Generate each with: openssl rand -hex 32
 *
 * Rotation playbook:
 *   1. Set NEW value as ADMIN_CONTEXT_SECRET
 *   2. Move OLD value to ADMIN_CONTEXT_SECRET_PREVIOUS
 *   3. Wait > TTL_HOURS, then unset _PREVIOUS
 */
function getSecrets(): { active: Buffer; previous: Buffer | null } {
  const active = process.env.ADMIN_CONTEXT_SECRET;
  if (!active) {
    throw new Error(
      "ADMIN_CONTEXT_SECRET is not set. " +
        "Generate one with: openssl rand -hex 32 " +
        "and add it to .env.local"
    );
  }
  const previous = process.env.ADMIN_CONTEXT_SECRET_PREVIOUS || null;
  return {
    active: Buffer.from(active, "utf8"),
    previous: previous ? Buffer.from(previous, "utf8") : null,
  };
}

/**
 * Derives a stable session fingerprint from Supabase's auth refresh token.
 *
 * Why a fingerprint instead of the raw token?
 *   - We must NOT store the refresh token (or any prefix of it) in a
 *     separate cookie — defeats httpOnly hardening.
 *   - SHA-256 of the token is irreversible. We only need equality checks
 *     to bind the admin-context cookie to the current session.
 *   - We use only the first 16 hex chars of the digest (64 bits) — enough
 *     entropy for an equality check, keeps the cookie small.
 *
 * Returns null when no Supabase auth cookies are present (typically on
 * an unauthenticated request — caller should never reach here).
 */
async function deriveSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  // Supabase SSR puts the auth payload in `sb-<project>-auth-token`
  // (sometimes split into `.0`, `.1` chunks for large tokens).
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

interface AdminContextPayloadV1 {
  orgId: string;
  userId: string;
  iat: number;
  exp: number;
  v: 1;
}

interface AdminContextPayloadV2 {
  orgId: string;
  userId: string;
  sid: string; // session fingerprint (16 hex chars)
  iat: number;
  exp: number;
  v: 2;
}

type AdminContextPayload = AdminContextPayloadV1 | AdminContextPayloadV2;

function signWith(secret: Buffer, payload: AdminContextPayload): string {
  const data = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", secret).update(data).digest("hex");
  const encoded = Buffer.from(data).toString("base64url");
  return `${encoded}.${hmac}`;
}

function tryVerify(secret: Buffer, encoded: string, hmac: string): AdminContextPayload | null {
  try {
    if (!/^[a-f0-9]{64}$/.test(hmac)) return null;
    const data = Buffer.from(encoded, "base64url").toString("utf8");
    const expected = crypto.createHmac("sha256", secret).update(data).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"))) {
      return null;
    }

    const payload = JSON.parse(data) as AdminContextPayload;

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
    if (payload.v === 2 && typeof (payload as AdminContextPayloadV2).sid !== "string") {
      return null;
    }
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

function verify(token: string): AdminContextPayload | null {
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null;

  const encoded = token.substring(0, dotIndex);
  const hmac = token.substring(dotIndex + 1);

  const { active, previous } = getSecrets();

  // Try active key first (hot path), then previous (rotation grace period).
  const fromActive = tryVerify(active, encoded, hmac);
  if (fromActive) return fromActive;
  if (previous) {
    const fromPrevious = tryVerify(previous, encoded, hmac);
    if (fromPrevious) {
      console.warn(
        "[admin-context] cookie verified using PREVIOUS secret —",
        "rotation grace period in effect"
      );
      return fromPrevious;
    }
  }
  return null;
}

/**
 * Set the admin context cookie. Always issues v2 with a session fingerprint.
 * Call from switchAdminContext() after auth + org checks pass.
 */
export async function setAdminContext(orgId: string, userId: string): Promise<void> {
  const sid = await deriveSessionId();
  const now = Date.now();

  const payload: AdminContextPayload = sid
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
      "[admin-context] no Supabase auth cookies found — issuing v1 cookie without sid binding"
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

/** Clear the admin context cookie. Called when returning to admin org. */
export async function clearAdminContext(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Read and verify the admin context cookie.
 *
 * Returns validated `{ orgId, userId }` or null if no context / expired /
 * tampered / sid mismatch (v2 only).
 *
 * The caller MUST verify that `payload.userId` matches the current auth
 * session — readAdminContext only validates the cookie itself plus, for
 * v2, that it was issued for the same browser session.
 */
export async function readAdminContext(): Promise<{
  orgId: string;
  userId: string;
} | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;

  const payload = verify(cookie.value);
  if (!payload) return null;

  // v2: bind cookie to the current session fingerprint.
  // If session changed (logout/login or stolen cookie used elsewhere), reject.
  if (payload.v === 2) {
    const sid = await deriveSessionId();
    if (!sid || sid !== payload.sid) {
      console.warn(
        "[admin-context] sid mismatch — cookie rejected. Possible session change or replay attempt."
      );
      return null;
    }
  } else {
    // v1: log a deprecation warning. Still accepted to avoid forcing every
    // active session to re-pick context immediately after deploy.
    console.warn(
      "[admin-context] v1 cookie accepted (no sid binding). Will be re-issued as v2 on next setAdminContext()."
    );
  }

  return { orgId: payload.orgId, userId: payload.userId };
}

/**
 * Reissue the current cookie as v2 if it's still v1 — call right after a
 * successful op so users naturally upgrade. Best-effort; silent on failure.
 */
export async function maybeUpgradeCookie(): Promise<void> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return;

  const payload = verify(cookie.value);
  if (!payload || payload.v === CURRENT_VERSION) return;

  await setAdminContext(payload.orgId, payload.userId);
}
