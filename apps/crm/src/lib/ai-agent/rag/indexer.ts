import "server-only";

import {
  KNOWLEDGE_STORAGE_BUCKET,
  SOURCE_MAX_CHUNKS,
  VOYAGE_BATCH_MAX,
  type AgentIndexingJob,
  type AgentKnowledgeSource,
  type DocumentMimeType,
} from "@persia/shared/ai-agent";
import { errorMessage, logError, logInfo } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";
import { asAgentDb, type AgentDb } from "../db";
import { chunkText, type Chunk } from "./chunker";
import { parseDocument } from "./parsers";
import { embedTexts, VoyageMissingKeyError } from "./voyage-client";

interface StorageDownloadClient {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{
        data: Blob | { arrayBuffer(): Promise<ArrayBuffer> } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

type IndexerRpcClient = AgentDb & {
  rpc(
    fn:
      | "claim_agent_indexing_job"
      | "complete_agent_indexing_job"
      | "fail_agent_indexing_job",
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

type KnowledgeSourceRow = AgentKnowledgeSource;

export interface IndexingTickResult {
  claimed_job_id: string | null;
  processed_jobs: number;
  indexed_sources: number;
  failed_jobs: number;
  details: Array<{
    job_id: string;
    source_id: string;
    status: "done" | "failed";
    chunk_count?: number;
    tokens_embedded?: number;
    cost_usd_cents?: number;
    error?: string;
  }>;
}

export async function runIndexingTick(
  db: AgentDb = asAgentDb(createAdminClient()),
): Promise<IndexingTickResult> {
  const job = await claimIndexingJob(db);
  if (!job) {
    return {
      claimed_job_id: null,
      processed_jobs: 0,
      indexed_sources: 0,
      failed_jobs: 0,
      details: [],
    };
  }

  try {
    const source = await loadKnowledgeSource(db, job.organization_id, job.source_id);
    if (!source) {
      throw new Error("knowledge source not found");
    }

    const text = await loadSourceText(db, source);
    const chunks = chunkText(text);
    if (chunks.length > SOURCE_MAX_CHUNKS) {
      throw new Error(`Source exceeds max chunks of ${SOURCE_MAX_CHUNKS}`);
    }

    const embedded = await embedChunks(chunks);
    const chunkPayload = chunks.map((chunk, index) => ({
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      token_count: chunk.token_count,
      embedding: vectorToLiteral(embedded.embeddings[index] ?? []),
    }));

    const { data, error } = await (db as IndexerRpcClient).rpc(
      "complete_agent_indexing_job",
      {
        p_job_id: job.id,
        p_source_id: source.id,
        p_organization_id: source.organization_id,
        p_config_id: source.config_id,
        p_chunks: chunkPayload,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    const chunkCount = Number(data ?? chunkPayload.length);
    logInfo("ai_agent_rag_indexing_done", {
      organization_id: source.organization_id,
      source_id: source.id,
      job_id: job.id,
      chunk_count: chunkCount,
      tokens_embedded: embedded.totalTokens,
      cost_usd_cents: embedded.costUsdCents,
    });

    return {
      claimed_job_id: job.id,
      processed_jobs: 1,
      indexed_sources: 1,
      failed_jobs: 0,
      details: [{
        job_id: job.id,
        source_id: source.id,
        status: "done",
        chunk_count: chunkCount,
        tokens_embedded: embedded.totalTokens,
        cost_usd_cents: embedded.costUsdCents,
      }],
    };
  } catch (error) {
    const failureMessage =
      error instanceof VoyageMissingKeyError
        ? "VOYAGE_API_KEY not set"
        : errorMessage(error);

    await (db as IndexerRpcClient).rpc("fail_agent_indexing_job", {
      p_job_id: job.id,
      p_source_id: job.source_id,
      p_organization_id: job.organization_id,
      p_error_message: failureMessage,
    }).catch(() => {});

    logError("ai_agent_rag_indexing_failed", {
      organization_id: job.organization_id,
      source_id: job.source_id,
      job_id: job.id,
      error: failureMessage,
    });

    return {
      claimed_job_id: job.id,
      processed_jobs: 1,
      indexed_sources: 0,
      failed_jobs: 1,
      details: [{
        job_id: job.id,
        source_id: job.source_id,
        status: "failed",
        error: failureMessage,
      }],
    };
  }
}

async function claimIndexingJob(db: AgentDb): Promise<AgentIndexingJob | null> {
  const { data, error } = await (db as IndexerRpcClient).rpc("claim_agent_indexing_job", {
    p_max_attempts: 3,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as AgentIndexingJob | null;
}

async function loadKnowledgeSource(
  db: AgentDb,
  orgId: string,
  sourceId: string,
): Promise<KnowledgeSourceRow | null> {
  const { data, error } = await db
    .from("agent_knowledge_sources")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", sourceId)
    .maybeSingle();

  if (error || !data) return null;
  return data as KnowledgeSourceRow;
}

async function loadSourceText(db: AgentDb, source: KnowledgeSourceRow): Promise<string> {
  if (source.source_type === "faq") {
    const metadata = source.metadata as { question?: string; answer?: string };
    return `Q: ${metadata.question ?? ""}\nA: ${metadata.answer ?? ""}`.trim();
  }

  const metadata = source.metadata as {
    storage_path?: string;
    mime_type?: DocumentMimeType;
  };
  if (!metadata.storage_path || !metadata.mime_type) {
    throw new Error("document metadata is incomplete");
  }

  const { data, error } = await (createAdminClient() as unknown as StorageDownloadClient)
    .storage
    .from(KNOWLEDGE_STORAGE_BUCKET)
    .download(metadata.storage_path);

  if (error || !data) {
    throw new Error(error?.message || "failed to download knowledge source");
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return parseDocument(buffer, metadata.mime_type);
}

async function embedChunks(chunks: Chunk[]): Promise<{
  embeddings: number[][];
  totalTokens: number;
  costUsdCents: number;
}> {
  const allEmbeddings: number[][] = [];
  let totalTokens = 0;
  let costUsdCents = 0;

  for (let index = 0; index < chunks.length; index += VOYAGE_BATCH_MAX) {
    const batch = chunks.slice(index, index + VOYAGE_BATCH_MAX);
    const embedded = await embedTexts(
      batch.map((chunk) => chunk.content),
      "document",
    );
    allEmbeddings.push(...embedded.embeddings);
    totalTokens += embedded.totalTokens;
    costUsdCents += embedded.costUsdCents;
  }

  return {
    embeddings: allEmbeddings,
    totalTokens,
    costUsdCents,
  };
}

function vectorToLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
