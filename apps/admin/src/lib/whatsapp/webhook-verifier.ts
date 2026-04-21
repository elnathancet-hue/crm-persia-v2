import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validates Meta Cloud API webhook signature.
 *
 * Meta signs the **raw request body** with HMAC-SHA256 using the App Secret.
 * The signature arrives in the `X-Hub-Signature-256` header as `sha256=<hex>`.
 *
 * @param rawBody   The exact bytes Meta sent — NOT the parsed/stringified JSON.
 *                  In Next.js App Router, read via `await req.text()` BEFORE JSON.parse.
 * @param signature The full `X-Hub-Signature-256` header value (e.g. "sha256=abc123...").
 * @param appSecret The App Secret of the Meta App receiving the webhook.
 * @returns true only if the signature matches. Returns false (never throws) for any
 *          malformed input so the caller can respond with 401 and move on.
 */
export function validateMetaSignature(rawBody: string, signature: string | null | undefined, appSecret: string): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;
  if (!appSecret) return false;

  const received = signature.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");

  // Defensive: both buffers must have the same length for timingSafeEqual.
  if (received.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Validates Meta webhook GET verification challenge.
 * Responds to `GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
 * by returning the challenge if the token matches.
 */
export function validateMetaChallenge(
  params: { mode: string | null; token: string | null; challenge: string | null },
  expectedToken: string,
): string | null {
  if (params.mode === "subscribe" && params.token === expectedToken && params.challenge) {
    return params.challenge;
  }
  return null;
}
