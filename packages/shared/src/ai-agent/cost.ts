// AI Agent — cost calculation helpers.
//
// Prices below are a starting table for org-level cost tracking. Codex runtime
// MUST re-validate current prices from the provider dashboard before relying
// on exact USD values in production — these numbers change and this table is
// not a source of truth for billing. For guardrail enforcement the token
// ceiling is what matters, not USD, so drift here is non-critical.

export interface ModelPricing {
  input_usd_per_1m: number;
  output_usd_per_1m: number;
}

// USD per 1M tokens. Verify against https://www.anthropic.com/pricing before
// using for anything user-facing. Unknown models return cost 0 (billable but
// untracked) — don't block execution on a missing entry.
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-opus-4-7": { input_usd_per_1m: 15, output_usd_per_1m: 75 },
  "claude-sonnet-4-6": { input_usd_per_1m: 3, output_usd_per_1m: 15 },
  "claude-haiku-4-5": { input_usd_per_1m: 0.25, output_usd_per_1m: 1.25 },
  // legacy — kept for rows that still reference older model ids
  "claude-sonnet-4-5": { input_usd_per_1m: 3, output_usd_per_1m: 15 },
};

export const DEFAULT_MODEL = "claude-sonnet-4-6" as const;

export function isKnownModel(model: string): boolean {
  return model in MODEL_PRICING;
}

export function calculateCostUsdCents(
  model: string,
  tokensInput: number,
  tokensOutput: number,
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const usdDollars =
    (tokensInput / 1_000_000) * pricing.input_usd_per_1m +
    (tokensOutput / 1_000_000) * pricing.output_usd_per_1m;
  return Math.round(usdDollars * 100);
}
