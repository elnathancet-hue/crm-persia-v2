import "server-only";

import {
  VOYAGE_BATCH_MAX,
  VOYAGE_DIM,
  VOYAGE_MODEL,
  VOYAGE_PRICING_USD_PER_1M,
  type VoyageInputType,
} from "@persia/shared/ai-agent";

const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_TIMEOUT_MS = 60_000;
const VOYAGE_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

export class VoyageMissingKeyError extends Error {
  constructor() {
    super("VOYAGE_API_KEY not set");
    this.name = "VoyageMissingKeyError";
  }
}

export interface VoyageEmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
  costUsdCents: number;
}

interface VoyageResponse {
  data?: Array<{ embedding?: number[] }>;
  usage?: {
    total_tokens?: number;
  };
}

export async function embedTexts(
  input: string[],
  inputType: VoyageInputType,
): Promise<VoyageEmbeddingResult> {
  if (input.length === 0) {
    return { embeddings: [], totalTokens: 0, costUsdCents: 0 };
  }
  if (input.length > VOYAGE_BATCH_MAX) {
    throw new Error(`Voyage batch exceeds limit of ${VOYAGE_BATCH_MAX}`);
  }

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new VoyageMissingKeyError();
  }

  let attempt = 0;
  while (true) {
    try {
      const response = await fetchWithTimeout(VOYAGE_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
          model: VOYAGE_MODEL,
          input_type: inputType,
          output_dimension: VOYAGE_DIM,
        }),
      });

      if (response.status >= 500) {
        throw new RetryableVoyageError(`Voyage ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`Voyage request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as VoyageResponse;
      const embeddings = (payload.data ?? []).map((row) => row.embedding ?? []);
      if (embeddings.length !== input.length) {
        throw new Error("Voyage response length mismatch");
      }
      const wrongDim = embeddings.find((vec) => vec.length !== VOYAGE_DIM);
      if (wrongDim) {
        throw new Error(
          `Voyage retornou dim ${wrongDim.length}, esperado ${VOYAGE_DIM} (modelo ${VOYAGE_MODEL}). Verifique se output_dimension está sendo aceito.`,
        );
      }

      const totalTokens = Number(payload.usage?.total_tokens ?? 0);
      return {
        embeddings,
        totalTokens,
        costUsdCents: Math.round((totalTokens / 1_000_000) * VOYAGE_PRICING_USD_PER_1M * 100),
      };
    } catch (error) {
      if (!isRetryableError(error) || attempt >= VOYAGE_MAX_RETRIES) {
        throw error;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      attempt += 1;
    }
  }
}

export async function embedQuery(query: string): Promise<VoyageEmbeddingResult> {
  return embedTexts([query], "query");
}

function isRetryableError(error: unknown): boolean {
  return error instanceof RetryableVoyageError || error instanceof TypeError;
}

class RetryableVoyageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableVoyageError";
  }
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
