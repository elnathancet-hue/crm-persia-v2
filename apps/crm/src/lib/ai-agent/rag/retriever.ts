import "server-only";

import {
  RAG_DISTANCE_CEILING,
  type RetrievalHit,
  type RetrievalQuery,
} from "@persia/shared/ai-agent";
import { errorMessage, logError } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { asAgentDb, type AgentDb } from "../db";
import { embedQuery, VoyageMissingKeyError } from "./voyage-client";

interface RetrievalRpcRow {
  chunk_id: string;
  source_id: string;
  source_type: RetrievalHit["source_type"];
  source_title: string;
  content: string;
  distance: number;
}

export interface RetrievalAttempt {
  success: boolean;
  hits: RetrievalHit[];
  tokensEmbedded: number;
  durationMs: number;
  error?: string;
}

type RetrieverRpcClient = AgentDb & {
  rpc(
    fn: "match_agent_knowledge_chunks",
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function retrieve(
  query: RetrievalQuery,
  db: AgentDb = asAgentDb(createAdminClient()),
): Promise<RetrievalHit[]> {
  const result = await retrieveWithAttempt(query, db);
  return result.hits;
}

export async function retrieveWithAttempt(
  query: RetrievalQuery,
  db: AgentDb = asAgentDb(createAdminClient()),
): Promise<RetrievalAttempt> {
  const startedAt = Date.now();

  try {
    const embedding = await embedQuery(query.query_text);
    const { data, error } = await (db as RetrieverRpcClient).rpc(
      "match_agent_knowledge_chunks",
      {
        p_organization_id: query.organization_id,
        p_config_id: query.config_id,
        p_query_embedding: vectorToLiteral(embedding.embeddings[0] ?? []),
        p_top_k: query.top_k,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    const hits = ((data ?? []) as RetrievalRpcRow[])
      .filter((row) => Number(row.distance) <= RAG_DISTANCE_CEILING)
      .map((row) => ({
        chunk_id: row.chunk_id,
        source_id: row.source_id,
        source_type: row.source_type,
        source_title: row.source_title,
        content: row.content,
        distance: Number(row.distance),
      }));

    return {
      success: true,
      hits,
      tokensEmbedded: embedding.totalTokens,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    logError("ai_agent_rag_retrieval_failed", {
      organization_id: query.organization_id,
      config_id: query.config_id,
      error: errorMessage(error),
    });

    return {
      success: false,
      hits: [],
      tokensEmbedded: 0,
      durationMs: Date.now() - startedAt,
      error:
        error instanceof VoyageMissingKeyError
          ? "VOYAGE_API_KEY not set"
          : errorMessage(error),
    };
  }
}

function vectorToLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
