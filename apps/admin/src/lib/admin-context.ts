"use server";

import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "admin-context";
const TTL_HOURS = 8;
const PAYLOAD_VERSION = 1;

/**
 * Returns the ADMIN_CONTEXT_SECRET from env.
 * This secret is used ONLY for signing/verifying the admin context cookie.
 * It MUST be a strong, random, long string — NOT derived from any other env var.
 * Generate with: openssl rand -hex 32
 */
function getSecret(): Buffer {
  const secret = process.env.ADMIN_CONTEXT_SECRET;
  if (!secret) {
    throw new Error(
      "ADMIN_CONTEXT_SECRET is not set. " +
      "Generate one with: openssl rand -hex 32 " +
      "and add it to .env.local"
    );
  }
  return Buffer.from(secret, "utf8");
}

interface AdminContextPayload {
  orgId: string;
  userId: string;
  iat: number; // issued at (unix ms)
  exp: number; // expires at (unix ms)
  v: number;   // payload version
}

function sign(payload: AdminContextPayload): string {
  const data = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
  const encoded = Buffer.from(data).toString("base64url");
  return `${encoded}.${hmac}`;
}

function verify(token: string): AdminContextPayload | null {
  try {
    const dotIndex = token.indexOf(".");
    if (dotIndex === -1 || dotIndex === 0 || dotIndex === token.length - 1) return null;

    const encoded = token.substring(0, dotIndex);
    const hmac = token.substring(dotIndex + 1);

    // Validate hex format before timingSafeEqual
    if (!/^[a-f0-9]{64}$/.test(hmac)) return null;

    const data = Buffer.from(encoded, "base64url").toString("utf8");
    const expected = crypto.createHmac("sha256", getSecret()).update(data).digest("hex");

    // Timing-safe comparison (both are hex strings, guaranteed same length = 64)
    if (!crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"))) return null;

    const payload: AdminContextPayload = JSON.parse(data);

    // Validate structure
    if (!payload.orgId || !payload.userId || !payload.exp || !payload.v) return null;

    // Check version
    if (payload.v !== PAYLOAD_VERSION) return null;

    // Check TTL
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    // Malformed cookie — return null, never crash
    return null;
  }
}

/** Set the admin context cookie. Called by switchAdminContext(). */
export async function setAdminContext(orgId: string, userId: string): Promise<void> {
  const now = Date.now();
  const payload: AdminContextPayload = {
    orgId,
    userId,
    iat: now,
    exp: now + TTL_HOURS * 60 * 60 * 1000,
    v: PAYLOAD_VERSION,
  };
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sign(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: TTL_HOURS * 60 * 60,
  });
}

/** Clear the admin context cookie. Called when returning to admin org. */
export async function clearAdminContext(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Read and verify the admin context cookie.
 * Returns validated { orgId, userId } or null if no context / expired / tampered.
 * The caller MUST verify that payload.userId matches the current auth session.
 */
export async function readAdminContext(): Promise<{ orgId: string; userId: string } | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;

  const payload = verify(cookie.value);
  if (!payload) return null;

  return { orgId: payload.orgId, userId: payload.userId };
}
