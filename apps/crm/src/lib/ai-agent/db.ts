import type { AdminClient } from "@/lib/supabase/admin";

export type AgentDb = {
  from: (table: string) => any;
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function asAgentDb(client: AdminClient | { from: (table: string) => any }): AgentDb {
  return client as unknown as AgentDb;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function mergeJsonObject(
  base: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...asRecord(base), ...patch };
}
