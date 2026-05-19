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

/**
 * PR-FIX-GPT5-DEADLINE (mai/2026): irmão dos fixes de tokens (* 4) e
 * timeout per-call (* 3) em executor.ts. Esse assert é o deadline GLOBAL
 * do run inteiro, checado entre iterações do loop. Sem o multiplier,
 * mesmo se cada LLM call individual passar (graças ao withTimeout * 3),
 * o segundo call já chega cumulativamente > 30s e cai em GuardrailError
 * aqui — caminho que renderiza step `stepType='guardrail'` na UI +
 * HANDOFF_REPLY literal pro cliente.
 *
 * Sintoma observado em Test 3 pós-deploy do PR #267:
 *   Step 1 (Pensamento da IA): 13.3s
 *   Step 2 (transfer_to_stage): +66ms
 *   Step 3 (Pensamento da IA): elapsed 32.3s (= 18.9s só nessa call)
 *   Step 4 (Verificacao de regra): 32.5s — guardrail FIRE
 *
 * O fix de withTimeout sozinho não basta porque o deadline cumulativo
 * estoura entre iterações. Triplicamos aqui pelo mesmo critério.
 */
export function assertWithinDeadline(
  startedAt: number,
  guardrails: AgentGuardrails,
  model?: string,
): void {
  const elapsedMs = Date.now() - startedAt;
  const multiplier = model?.startsWith("gpt-5") ? 3 : 1;
  const limitMs = guardrails.timeout_seconds * 1000 * multiplier;
  if (elapsedMs > limitMs) {
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
