type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY_RE =
  /(token|secret|password|authorization|signature|phone$|telefone|content|message_text|base64|media_url|file_url|url$)/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (SENSITIVE_KEY_RE.test(key) && typeof value !== "boolean") return "[redacted]";
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = sanitizeValue(childKey, childValue);
  }
  return result;
}

function sanitizeFields(fields: LogFields = {}): LogFields {
  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getRequestId(headers?: Headers | null): string {
  return headers?.get("x-request-id") || crypto.randomUUID();
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const payload = {
    event,
    service: "crm",
    ...sanitizeFields(fields),
  };

  if (level === "error") {
    console.error(`[crm:${event}]`, payload);
  } else if (level === "warn") {
    console.warn(`[crm:${event}]`, payload);
  } else {
    console.info(`[crm:${event}]`, payload);
  }
}

export function logInfo(event: string, fields?: LogFields): void {
  logEvent("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  logEvent("warn", event, fields);
}

export function logError(event: string, fields?: LogFields): void {
  logEvent("error", event, fields);
}
