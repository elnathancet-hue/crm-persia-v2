import {
  DEFAULT_GUARDRAILS,
  type GuardrailTripReason,
  type AgentGuardrails,
} from "@persia/shared/ai-agent";
import { asRecord } from "./db";

export function normalizeGuardrails(value: unknown): AgentGuardrails {
  const raw = asRecord(value);
  return {
    max_iterations: positiveInt(raw.max_iterations, DEFAULT_GUARDRAILS.max_iterations),
    timeout_seconds: positiveInt(raw.timeout_seconds, DEFAULT_GUARDRAILS.timeout_seconds),
    cost_ceiling_tokens: positiveInt(
      raw.cost_ceiling_tokens,
      DEFAULT_GUARDRAILS.cost_ceiling_tokens,
    ),
    allow_human_handoff:
      typeof raw.allow_human_handoff === "boolean"
        ? raw.allow_human_handoff
        : DEFAULT_GUARDRAILS.allow_human_handoff,
  };
}

export function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function assertWithinDeadline(startedAt: number, guardrails: AgentGuardrails): void {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > guardrails.timeout_seconds * 1000) {
    throw new GuardrailError("run_cost_timeout", "AI agent execution timed out");
  }
}

export function assertWithinCostCeiling(
  tokensInput: number,
  tokensOutput: number,
  guardrails: AgentGuardrails,
): void {
  if (tokensInput + tokensOutput > guardrails.cost_ceiling_tokens) {
    throw new GuardrailError("run_cost_tokens", "AI agent token ceiling reached");
  }
}

export class GuardrailError extends Error {
  constructor(
    public readonly reason: GuardrailTripReason,
    message: string,
  ) {
    super(message);
    this.name = "GuardrailError";
  }
}
