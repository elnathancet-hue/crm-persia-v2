import { createHash, createHmac } from "node:crypto";
import { resolve4 as defaultResolve4, resolve6 as defaultResolve6 } from "node:dns/promises";
import * as https from "node:https";
import { isIP } from "node:net";
import {
  CUSTOM_WEBHOOK_LIMITS,
  type CustomWebhookInvocation,
  type CustomWebhookResult,
  type OrganizationSettings,
  WEBHOOK_ALLOWLIST_KEY,
} from "@persia/shared/ai-agent";
import { asRecord } from "./db";

type Resolve4 = typeof defaultResolve4;
type Resolve6 = typeof defaultResolve6;

type WebhookResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
};

type RequestOptions = {
  url: URL;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
  resolvedIp: string;
  originalHost: string;
  signal: AbortSignal;
};

type RequestFn = (options: RequestOptions) => Promise<WebhookResponse>;

export interface WebhookCallerDeps {
  resolve4?: Resolve4;
  resolve6?: Resolve6;
  request?: RequestFn;
  now?: () => number;
}

export interface WebhookInvocationResult extends CustomWebhookResult {
  audit_output: Record<string, unknown>;
}

class WebhookCallError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WebhookCallError";
  }
}

export async function invokeCustomWebhook(
  invocation: CustomWebhookInvocation & { allowlist: string[] },
  deps: WebhookCallerDeps = {},
): Promise<WebhookInvocationResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const requestBody = JSON.stringify({
    tool_id: invocation.tool_id,
    payload: invocation.payload,
    context: invocation.context,
  });
  const bodySha = sha256Hex(requestBody);
  const urlHost = safeHost(invocation.webhook_url);

  try {
    const url = parseAndValidateWebhookUrl(invocation.webhook_url);
    assertHostnameAllowed(url.hostname, invocation.allowlist);

    const resolvedIps = await resolvePublicIps(url.hostname, deps);
    const timestamp = String(now());
    const signature = createHmac(CUSTOM_WEBHOOK_LIMITS.signature_algo, invocation.webhook_secret)
      .update(`${timestamp}.${requestBody}`)
      .digest("hex");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CUSTOM_WEBHOOK_LIMITS.timeout_ms);

    try {
      const response = await (deps.request ?? defaultRequest)({
        url,
        body: requestBody,
        headers: {
          "content-type": "application/json",
          [CUSTOM_WEBHOOK_LIMITS.signature_header]: `${CUSTOM_WEBHOOK_LIMITS.signature_algo}=${signature}`,
          "X-Persia-Timestamp": timestamp,
        },
        timeoutMs: CUSTOM_WEBHOOK_LIMITS.timeout_ms,
        maxResponseBytes: CUSTOM_WEBHOOK_LIMITS.max_response_bytes,
        resolvedIp: resolvedIps[0],
        originalHost: url.hostname,
        signal: controller.signal,
      });

      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw new WebhookCallError("redirect_disallowed", "Webhook redirects are not allowed");
      }

      const { text, sizeBytes, sha256 } = await readResponseBody(
        response.body,
        CUSTOM_WEBHOOK_LIMITS.max_response_bytes,
      );
      const durationMs = now() - startedAt;
      const auditOutput = {
        http_status: response.statusCode,
        duration_ms: durationMs,
        url_host: url.hostname,
        body_sha256: bodySha,
        response_size_bytes: sizeBytes,
        response_sha256: sha256,
      };

      if (response.statusCode < 200 || response.statusCode >= 300) {
        return {
          success: false,
          output: {
            error: `Webhook returned HTTP ${response.statusCode}`,
            http_status: response.statusCode,
          },
          http_status: response.statusCode,
          duration_ms: durationMs,
          error: `Webhook returned HTTP ${response.statusCode}`,
          audit_output: auditOutput,
        };
      }

      return {
        success: true,
        output: parseResponseOutput(text, response.headers["content-type"]),
        http_status: response.statusCode,
        duration_ms: durationMs,
        audit_output: auditOutput,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const durationMs = now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof WebhookCallError
        ? error.code
        : error instanceof DOMException && error.name === "AbortError"
          ? "timeout"
          : "webhook_failed";

    return {
      success: false,
      output: { error: message, code },
      http_status: 0,
      duration_ms: durationMs,
      error: message,
      audit_output: {
        http_status: 0,
        duration_ms: durationMs,
        url_host: urlHost,
        body_sha256: bodySha,
        response_size_bytes: 0,
        response_sha256: null,
        error: message,
        code,
      },
    };
  }
}

export function getWebhookAllowlistDomains(settings: unknown): string[] {
  const root = asRecord(settings as OrganizationSettings | null | undefined);
  const allowlist = asRecord(root[WEBHOOK_ALLOWLIST_KEY]);
  const domains = Array.isArray(allowlist.domains) ? allowlist.domains : [];
  return Array.from(
    new Set(
      domains
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort();
}

export function normalizeAllowedDomain(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Dominio obrigatorio");

  const parsed = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
  const hostname = parsed.hostname.toLowerCase();

  if (!hostname) throw new Error("Dominio invalido");
  if (parsed.port) throw new Error("Portas customizadas nao sao permitidas");
  if (hostname.includes(":") || hostname.includes("[") || isIP(hostname) > 0) {
    throw new Error("Use um hostname publico, nao um IP literal");
  }

  return hostname;
}

export function parseAndValidateWebhookUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookCallError("invalid_url", "Webhook URL is invalid");
  }

  if (url.protocol !== "https:") {
    throw new WebhookCallError("invalid_scheme", "Webhook URL must use HTTPS");
  }

  if (!url.hostname || url.hostname.includes("[") || url.hostname.includes("]") || url.hostname.includes(":")) {
    throw new WebhookCallError("invalid_hostname", "Webhook hostname must be a public DNS name");
  }

  if (isIP(url.hostname) > 0) {
    throw new WebhookCallError("ip_literal_blocked", "Webhook URL cannot use an IP literal");
  }

  const port = url.port ? Number(url.port) : 443;
  if (port !== 443) {
    throw new WebhookCallError("invalid_port", "Webhook URL must use port 443");
  }

  return url;
}

export function assertHostnameAllowed(hostname: string, allowlist: string[]): void {
  const normalized = hostname.trim().toLowerCase();
  if (!allowlist.map((entry) => entry.trim().toLowerCase()).includes(normalized)) {
    throw new WebhookCallError("allowlist_miss", "Webhook hostname is not in the organization allowlist");
  }
}

export async function resolvePublicIps(
  hostname: string,
  deps: Pick<WebhookCallerDeps, "resolve4" | "resolve6"> = {},
): Promise<string[]> {
  const resolve4 = deps.resolve4 ?? defaultResolve4;
  const resolve6 = deps.resolve6 ?? defaultResolve6;

  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => [] as string[]),
    resolve6(hostname).catch(() => [] as string[]),
  ]);

  const ips = [...ipv4, ...ipv6].map((value) => value.toLowerCase());
  if (ips.length === 0) {
    throw new WebhookCallError("dns_resolution_failed", "Webhook hostname could not be resolved");
  }

  for (const ip of ips) {
    if (isPrivateOrReservedIp(ip)) {
      throw new WebhookCallError("private_ip_blocked", "Webhook hostname resolves to a private or reserved IP");
    }
  }

  return ips;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  if (isIP(ip) === 6) return isPrivateIpv6(ip);
  return true;
}

async function defaultRequest(options: RequestOptions): Promise<WebhookResponse> {
  return await new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: options.url.protocol,
        hostname: options.originalHost,
        path: `${options.url.pathname}${options.url.search}`,
        method: "POST",
        port: 443,
        headers: {
          ...options.headers,
          "content-length": Buffer.byteLength(options.body).toString(),
          host: options.originalHost,
        },
        servername: options.originalHost,
        signal: options.signal,
        lookup: (_hostname, _opts, callback) => {
          callback(null, options.resolvedIp, isIP(options.resolvedIp));
        },
      },
      (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers as Record<string, string | string[] | undefined>,
          body: response,
        });
      },
    );

    request.on("error", reject);
    request.write(options.body);
    request.end();
  });
}

async function readResponseBody(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<{ text: string; sizeBytes: number; sha256: string | null }> {
  const chunks: Buffer[] = [];
  let sizeBytes = 0;

  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.length;
    if (sizeBytes > maxBytes) {
      throw new WebhookCallError("response_too_large", "Webhook response exceeded the maximum size");
    }
    chunks.push(buffer);
  }

  const merged = Buffer.concat(chunks);
  return {
    text: merged.toString("utf8"),
    sizeBytes,
    sha256: sizeBytes > 0 ? sha256Hex(merged) : null,
  };
}

function parseResponseOutput(
  text: string,
  contentType: string | string[] | undefined,
): Record<string, unknown> {
  const normalizedType = Array.isArray(contentType) ? contentType[0] : contentType;
  const trimmed = text.trim();

  if (!trimmed) return { ok: true };

  if (normalizedType?.includes("application/json")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { data: parsed };
    } catch {
      return { text: trimmed };
    }
  }

  return { text: trimmed };
}

function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  const ranges: Array<[number, number]> = [
    [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],
    [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
    [ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")],
    [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
    [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
    [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
    [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
    [ipv4ToInt("224.0.0.0"), ipv4ToInt("239.255.255.255")],
    [ipv4ToInt("240.0.0.0"), ipv4ToInt("255.255.255.255")],
  ];

  return ranges.some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8")) return true;

  const expanded = expandIpv6(normalized);
  const firstHextet = parseInt(expanded.slice(0, 4), 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true;

  if (normalized.startsWith("::ffff:")) {
    const mapped = extractMappedIpv4(normalized);
    return mapped ? isPrivateIpv4(mapped) : true;
  }

  return false;
}

function extractMappedIpv4(ip: string): string | null {
  const tail = ip.slice("::ffff:".length);
  if (isIP(tail) === 4) return tail;

  const parts = tail.split(":").filter(Boolean);
  if (parts.length !== 2) return null;
  const first = parseInt(parts[0], 16);
  const second = parseInt(parts[1], 16);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  return [
    (first >> 8) & 0xff,
    first & 0xff,
    (second >> 8) & 0xff,
    second & 0xff,
  ].join(".");
}

function expandIpv6(ip: string): string {
  const [leftRaw, rightRaw] = ip.split("::");
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(":").filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  const middle = new Array(Math.max(0, missing)).fill("0");
  return [...left, ...middle, ...right].map((part) => part.padStart(4, "0")).join("");
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
