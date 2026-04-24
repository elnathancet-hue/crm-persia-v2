// AI Agent — cost calculation helpers.
//
// Prices below are a starting table for org-level cost tracking. Runtime
// MUST re-validate current prices from https://openai.com/pricing before
// relying on exact USD values for billing. For guardrail enforcement the
// token ceiling is what matters, not USD, so drift here is non-critical.

export interface ModelPricing {
  input_usd_per_1m: number;
  output_usd_per_1m: number;
}

// USD per 1M tokens. Update from https://openai.com/pricing when OpenAI
// revises. Unknown models return cost 0 (billable but untracked) — never
// block execution on a missing entry.
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Customer-facing / agent-selectable models
  "gpt-5": { input_usd_per_1m: 1.25, output_usd_per_1m: 10 },
  "gpt-5-mini": { input_usd_per_1m: 0.25, output_usd_per_1m: 2 },
  "gpt-4o": { input_usd_per_1m: 2.5, output_usd_per_1m: 10 },
  // Runtime-internal (summarization, handoff brief, meta-IA)
  "gpt-4o-mini": { input_usd_per_1m: 0.15, output_usd_per_1m: 0.6 },
};

// Default model a new agent uses when the admin does not pick one.
// UI exposes gpt-5-mini, gpt-4o-mini, gpt-4o, gpt-5 — runtime accepts any
// key present in MODEL_PRICING.
export const DEFAULT_MODEL = "gpt-5-mini" as const;

// Meta-AI calls (context summarization, handoff notification brief, future
// Construtor de Prompt in PR8) use this fixed model regardless of the
// per-agent `config.model`. Cheaper + fast, good enough for short prose.
// NOT user-selectable — runtime constant only.
export const INTERNAL_MODEL = "gpt-4o-mini" as const;

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
