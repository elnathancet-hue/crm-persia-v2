import type { AdminClient } from "@/lib/supabase-admin";

export type AgentDb = AdminClient;

export function fromAny(db: AgentDb, table: string): any {
  return (db as any).from(table);
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
