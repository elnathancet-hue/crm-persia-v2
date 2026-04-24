import { resolve4 as defaultResolve4, resolve6 as defaultResolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import {
  type OrganizationSettings,
  WEBHOOK_ALLOWLIST_KEY,
} from "@persia/shared/ai-agent";
import { asRecord } from "./db";

type Resolve4 = typeof defaultResolve4;
type Resolve6 = typeof defaultResolve6;

interface ResolveDeps {
  resolve4?: Resolve4;
  resolve6?: Resolve6;
}

class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookValidationError";
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
  if (!raw) throw new Error("Domínio obrigatório");

  const parsed = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
  const hostname = parsed.hostname.toLowerCase();

  if (!hostname) throw new Error("Domínio inválido");
  if (parsed.port) throw new Error("Portas customizadas não são permitidas");
  if (hostname.includes(":") || hostname.includes("[") || isIP(hostname) > 0) {
    throw new Error("Use um hostname público, não um IP literal");
  }

  return hostname;
}

export function parseAndValidateWebhookUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookValidationError("Webhook URL inválida");
  }

  if (url.protocol !== "https:") {
    throw new WebhookValidationError("Webhook URL deve usar HTTPS");
  }

  if (!url.hostname || url.hostname.includes("[") || url.hostname.includes("]") || url.hostname.includes(":")) {
    throw new WebhookValidationError("Webhook hostname deve ser um DNS público");
  }

  if (isIP(url.hostname) > 0) {
    throw new WebhookValidationError("Webhook URL não pode usar IP literal");
  }

  const port = url.port ? Number(url.port) : 443;
  if (port !== 443) {
    throw new WebhookValidationError("Webhook URL deve usar a porta 443");
  }

  return url;
}

export function assertHostnameAllowed(hostname: string, allowlist: string[]): void {
  const normalized = hostname.trim().toLowerCase();
  if (!allowlist.map((entry) => entry.trim().toLowerCase()).includes(normalized)) {
    throw new WebhookValidationError("Hostname do webhook não está na allowlist da organização");
  }
}

export async function resolvePublicIps(
  hostname: string,
  deps: ResolveDeps = {},
): Promise<string[]> {
  const resolve4 = deps.resolve4 ?? defaultResolve4;
  const resolve6 = deps.resolve6 ?? defaultResolve6;

  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => [] as string[]),
    resolve6(hostname).catch(() => [] as string[]),
  ]);

  const ips = [...ipv4, ...ipv6].map((value) => value.toLowerCase());
  if (ips.length === 0) {
    throw new WebhookValidationError("Hostname do webhook não pôde ser resolvido");
  }

  for (const ip of ips) {
    if (isPrivateOrReservedIp(ip)) {
      throw new WebhookValidationError("Hostname do webhook resolve para IP privado ou reservado");
    }
  }

  return ips;
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  if (isIP(ip) === 6) return isPrivateIpv6(ip);
  return true;
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
