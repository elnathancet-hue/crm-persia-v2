import type { NativeHandlerContext, NativeHandlerResult } from "@persia/shared/ai-agent";
import { asAgentDb, nowIso, type AgentDb } from "../db";

export interface HandlerContextWithDb extends NativeHandlerContext {
  db?: AgentDb;
}

export function getHandlerDb(context: NativeHandlerContext): AgentDb | null {
  const candidate = (context as HandlerContextWithDb).db;
  if (!candidate || typeof candidate !== "object") return null;
  return asAgentDb(candidate);
}

export function successResult(
  output: Record<string, unknown>,
  sideEffects?: string[],
): NativeHandlerResult {
  return {
    success: true,
    output,
    side_effects: sideEffects ?? [],
  };
}

export function failureResult(error: string, output: Record<string, unknown> = {}): NativeHandlerResult {
  return {
    success: false,
    output,
    error,
  };
}

export function trimReason(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 500)
    : fallback;
}

export async function insertLeadActivity(params: {
  db: AgentDb;
  organizationId: string;
  leadId: string;
  type: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await params.db.from("lead_activities").insert({
    organization_id: params.organizationId,
    lead_id: params.leadId,
    type: params.type,
    description: params.description,
    metadata: {
      source: "ai_agent",
      ...params.metadata,
    },
    performed_by: null,
    created_at: nowIso(),
  });
}
