type JsonRecord = Record<string, unknown>;

export type UazapiMatchMethod = "instance_token" | "owner_phone_legacy" | "none";

export interface UazapiConnectionForMatch {
  instance_token: string | null;
  phone_number: string | null;
}

interface DiagnosticHeaders {
  hasXSignature: boolean;
  hasXUazapiSignature: boolean;
  hasXHubSignature256: boolean;
}

export interface UazapiWebhookDiagnostics {
  eventType: string | null;
  matchedBy: UazapiMatchMethod;
  hasBodyToken: boolean;
  hasOwner: boolean;
  hasMessage: boolean;
  hasChat: boolean;
  headers: DiagnosticHeaders;
  bodyKeys: string[];
  messageKeys: string[];
  chatKeys: string[];
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function safeString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function sortedKeys(value: unknown, max = 40): string[] {
  const record = asRecord(value);
  if (!record) return [];
  return Object.keys(record).sort().slice(0, max);
}

function normalizeDigits(value: unknown): string {
  return safeString(value).replace(/\D/g, "");
}

function getHeaderDiagnostics(headers: Headers): DiagnosticHeaders {
  return {
    hasXSignature: headers.has("x-signature"),
    hasXUazapiSignature: headers.has("x-uazapi-signature"),
    hasXHubSignature256: headers.has("x-hub-signature-256"),
  };
}

function extractEventType(body: unknown): string | null {
  const root = asRecord(body);
  const message = asRecord(root?.message);
  const candidates = [
    root?.EventType,
    root?.eventType,
    root?.event,
    root?.type,
    message?.EventType,
    message?.eventType,
  ];

  const value = candidates.find((candidate) => typeof candidate === "string");
  if (typeof value !== "string" || value.length === 0) return null;
  return value.slice(0, 80);
}

export function extractUazapiOwnerPhone(body: unknown): string {
  const root = asRecord(body);
  const message = asRecord(root?.message);
  return normalizeDigits(root?.owner || message?.owner);
}

export function extractUazapiWebhookToken(body: unknown): string {
  const root = asRecord(body);
  return safeString(root?.token);
}

export function getUazapiConnectionMatchMethod(
  connection: UazapiConnectionForMatch,
  params: { ownerPhone: string; webhookToken: string },
): UazapiMatchMethod {
  if (params.webhookToken && connection.instance_token === params.webhookToken) {
    return "instance_token";
  }

  const connPhone = normalizeDigits(connection.phone_number);
  if (connPhone && connPhone === params.ownerPhone) {
    return "owner_phone_legacy";
  }

  return "none";
}

export function getUazapiWebhookDiagnostics(params: {
  body: unknown;
  headers: Headers;
  matchedBy: UazapiMatchMethod;
}): UazapiWebhookDiagnostics {
  const root = asRecord(params.body);
  const message = asRecord(root?.message);
  const chat = asRecord(root?.chat);
  const owner = root?.owner || message?.owner;

  return {
    eventType: extractEventType(params.body),
    matchedBy: params.matchedBy,
    hasBodyToken: Boolean(safeString(root?.token)),
    hasOwner: Boolean(normalizeDigits(owner)),
    hasMessage: Boolean(message),
    hasChat: Boolean(chat),
    headers: getHeaderDiagnostics(params.headers),
    bodyKeys: sortedKeys(root),
    messageKeys: sortedKeys(message),
    chatKeys: sortedKeys(chat),
  };
}

/**
 * Safe-by-default diagnostics for UAZAPI webhooks.
 *
 * Default behavior logs only the legacy owner-phone fallback. Set
 * UAZAPI_WEBHOOK_DIAGNOSTICS=verbose temporarily to log every webhook shape
 * without token, phone, message text, or media contents.
 */
export function logUazapiWebhookDiagnostics(params: {
  body: unknown;
  headers: Headers;
  matchedBy: UazapiMatchMethod;
}): void {
  const verbose = process.env.UAZAPI_WEBHOOK_DIAGNOSTICS === "verbose";
  if (!verbose && params.matchedBy !== "owner_phone_legacy") return;

  const diagnostics = getUazapiWebhookDiagnostics(params);
  if (params.matchedBy === "owner_phone_legacy") {
    console.warn("[UAZAPI webhook] diagnostics", diagnostics);
  } else {
    console.info("[UAZAPI webhook] diagnostics", diagnostics);
  }
}
