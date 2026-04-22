import { createHmac, timingSafeEqual } from "node:crypto";

export type UazapiWebhookSignatureMode = "off" | "observe" | "enforce";

export interface UazapiWebhookSignatureResult {
  mode: UazapiWebhookSignatureMode;
  configured: boolean;
  present: boolean;
  valid: boolean;
  accepted: boolean;
  headerName: string | null;
}

const SIGNATURE_HEADERS = [
  "x-signature",
  "x-uazapi-signature",
  "x-hub-signature-256",
] as const;

function normalizeMode(value: string | undefined): UazapiWebhookSignatureMode {
  if (value === "enforce") return "enforce";
  if (value === "observe") return "observe";
  return "off";
}

function getSignatureHeader(headers: Headers): { name: string; value: string } | null {
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name);
    if (value) return { name, value };
  }
  return null;
}

function normalizeSignature(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("sha256=") ? trimmed.slice("sha256=".length) : trimmed;
}

function safeCompareHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;

  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function validateUazapiWebhookSignature(params: {
  rawBody: string;
  headers: Headers;
  secret?: string;
  mode?: string;
}): UazapiWebhookSignatureResult {
  const configured = Boolean(params.secret);
  const mode = configured ? normalizeMode(params.mode) : "off";
  const signature = getSignatureHeader(params.headers);
  const present = Boolean(signature);

  if (!configured || mode === "off") {
    return {
      mode: "off",
      configured,
      present,
      valid: false,
      accepted: true,
      headerName: signature?.name ?? null,
    };
  }

  const expected = createHmac("sha256", params.secret!)
    .update(params.rawBody, "utf8")
    .digest("hex");
  const received = signature ? normalizeSignature(signature.value) : "";
  const valid = present && safeCompareHex(received, expected);

  return {
    mode,
    configured,
    present,
    valid,
    accepted: mode === "observe" || valid,
    headerName: signature?.name ?? null,
  };
}
