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

const INDEXING_MAX_ATTEMPTS = 3;
const INDEXING_LEASE_TIMEOUT_MS = 5 * 60 * 1000;
const INDEXING_EXHAUSTED_ERROR = "max attempts reached";

// Auto-requeue de fontes que falharam por motivos *transitorios* — assim
// hotfixes de RAG (ex: trocar VOYAGE_MODEL apos um deploy) auto-recuperam
// items "Falhou" sem cliente precisar clicar Reindexar manualmente um por
// um. Erros realmente *definitivos* (PDF corrompido, max chunks estourado,
// OpenAI key faltando, attempts esgotados) NAO entram aqui pra evitar loop
// eterno.
const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  /Voyage.*status\s+(4\d\d|5\d\d)/i,        // 4xx/5xx do Voyage (cobre 400 do dim mismatch antes do PR #57)
  /expected.*\d+\s+dimensions/i,             // dim mismatch — cobre erro pre-PR #57
  /Voyage\s+response\s+length\s+mismatch/i,
  /Voyage\s+retornou\s+dim\s+\d+/i,          // PR #55 defensive check
  /timeout/i,
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i,
  /fetch failed/i,                           // node fetch generic
  /openai.*5\d\d/i,
  /openai.*rate\s*limit/i,
];

// Espera minima (ms) entre auto-requeues consecutivos pra mesma source.
// Usa updated_at da source como ancora — quando requeue acontece a source
// vira pending+updated_at=now; quando falha de novo vira failed+updated_at=now.
// 1h deixa hotfix propagar via deploy + um ciclo Voyage retry sem DDOS
// interno.
const AUTO_REQUEUE_COOLDOWN_MS = 60 * 60 * 1000;

// Cap por tick pra nao explodir custo Voyage caso varias fontes estejam
// failed por motivo transient. Itens que sobrarem entram no proximo tick.
const AUTO_REQUEUE_MAX_PER_TICK = 5;

// Marcador no error_message pra distinguir falhas que ja vieram de auto-
// requeue (evita reentry imediata se o motivo persistir).
const AUTO_REQUEUE_MARKER = "[auto-requeued]";

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
  await normalizeExhaustedJobs(db);
  await requeueTransientFailures(db);

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
    await markSourceProcessing(db, job.organization_id, job.source_id);

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

    await markJobFailed(db, job, failureMessage);

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
    p_max_attempts: INDEXING_MAX_ATTEMPTS,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as AgentIndexingJob | null;
}

// Re-enfileira automaticamente fontes em "failed" cujo motivo bate com
// um dos TRANSIENT_ERROR_PATTERNS — desde que tenha passado pelo menos
// AUTO_REQUEUE_COOLDOWN_MS desde a ultima atualizacao.
//
// Usado pra cenarios tipo: voce ajustou VOYAGE_MODEL e deployou.
// Sources que falharam por dim mismatch antes do deploy auto-recuperam
// na proxima execucao do cron, sem o cliente precisar clicar Reindexar
// item por item.
//
// NAO mexe em jobs de fontes ainda em pending/processing nem em fontes
// cujo erro indica problema definitivo (PDF corrompido, OPENAI_API_KEY
// faltando, max attempts esgotados).
export async function requeueTransientFailures(
  db: AgentDb,
): Promise<{ requeued: number; source_ids: string[] }> {
  const cutoffIso = new Date(Date.now() - AUTO_REQUEUE_COOLDOWN_MS).toISOString();

  const { data, error } = await db
    .from("agent_knowledge_sources")
    .select("id, organization_id, indexing_error, updated_at")
    .eq("indexing_status", "failed")
    .lte("updated_at", cutoffIso)
    .order("updated_at", { ascending: true })
    // Overfetch porque filtramos os patterns no client. 4x o cap permite
    // skipping de erros definitivos sem precisar paginar.
    .limit(AUTO_REQUEUE_MAX_PER_TICK * 4);

  if (error) {
    logError("ai_agent_rag_auto_requeue_select_failed", { error: error.message });
    return { requeued: 0, source_ids: [] };
  }

  if (!Array.isArray(data) || data.length === 0) {
    return { requeued: 0, source_ids: [] };
  }

  const transient = data
    .filter((row) => isTransientError(String(row.indexing_error ?? "")))
    .slice(0, AUTO_REQUEUE_MAX_PER_TICK);

  if (transient.length === 0) {
    return { requeued: 0, source_ids: [] };
  }

  const nowIso = new Date().toISOString();
  const sourceIds = transient.map((row) => String(row.id));

  // Reset das sources pra pending (dispara re-render do badge na UI).
  const { error: sourcesUpdateError } = await db
    .from("agent_knowledge_sources")
    .update({
      indexing_status: "pending",
      indexing_error: null,
      updated_at: nowIso,
    })
    .in("id", sourceIds);

  if (sourcesUpdateError) {
    logError("ai_agent_rag_auto_requeue_sources_update_failed", {
      error: sourcesUpdateError.message,
      source_ids: sourceIds,
    });
    return { requeued: 0, source_ids: [] };
  }

  // Cria jobs novos (attempts=0). NAO reusa os jobs antigos com attempts
  // esgotado — o claim_agent_indexing_job ignora jobs com attempts >= 3.
  const { error: jobsInsertError } = await db
    .from("agent_indexing_jobs")
    .insert(
      transient.map((row) => ({
        organization_id: String(row.organization_id),
        source_id: String(row.id),
        status: "pending",
        attempts: 0,
      })),
    );

  if (jobsInsertError) {
    // Rollback: volta sources pra failed pra evitar fica em pending sem job.
    await db
      .from("agent_knowledge_sources")
      .update({
        indexing_status: "failed",
        indexing_error: `${AUTO_REQUEUE_MARKER} ${jobsInsertError.message}`,
        updated_at: nowIso,
      })
      .in("id", sourceIds);

    logError("ai_agent_rag_auto_requeue_jobs_insert_failed", {
      error: jobsInsertError.message,
      source_ids: sourceIds,
    });
    return { requeued: 0, source_ids: [] };
  }

  logInfo("ai_agent_rag_auto_requeued", {
    count: transient.length,
    source_ids: sourceIds,
  });

  return { requeued: transient.length, source_ids: sourceIds };
}

function isTransientError(message: string): boolean {
  if (!message) return false;
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

async function normalizeExhaustedJobs(db: AgentDb): Promise<void> {
  const { data, error } = await db
    .from("agent_indexing_jobs")
    .select("id, organization_id, source_id, status, attempts, claimed_at")
    .in("status", ["pending", "processing"])
    .gte("attempts", INDEXING_MAX_ATTEMPTS);

  if (error || !Array.isArray(data) || data.length === 0) {
    return;
  }

  const nowIso = new Date().toISOString();
  const exhausted = data.filter((row) => {
    if (row.status === "pending") return true;
    if (row.status !== "processing") return false;
    if (!row.claimed_at) return true;

    const claimedAt = Date.parse(String(row.claimed_at));
    if (Number.isNaN(claimedAt)) return true;
    return Date.now() - claimedAt >= INDEXING_LEASE_TIMEOUT_MS;
  });

  if (exhausted.length === 0) {
    return;
  }

  const jobIds = exhausted.map((row) => String(row.id));
  const sourceIds = Array.from(new Set(exhausted.map((row) => String(row.source_id))));

  await db
    .from("agent_indexing_jobs")
    .update({
      status: "failed",
      error_message: INDEXING_EXHAUSTED_ERROR,
      updated_at: nowIso,
    })
    .in("id", jobIds);

  await db
    .from("agent_knowledge_sources")
    .update({
      indexing_status: "failed",
      indexing_error: INDEXING_EXHAUSTED_ERROR,
      updated_at: nowIso,
    })
    .in("id", sourceIds);
}

async function markSourceProcessing(
  db: AgentDb,
  organizationId: string,
  sourceId: string,
): Promise<void> {
  const { error } = await db
    .from("agent_knowledge_sources")
    .update({
      indexing_status: "processing",
      indexing_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", sourceId);

  if (error) {
    throw new Error(error.message);
  }
}

async function markJobFailed(
  db: AgentDb,
  job: AgentIndexingJob,
  failureMessage: string,
): Promise<void> {
  try {
    const { error } = await (db as IndexerRpcClient).rpc("fail_agent_indexing_job", {
      p_job_id: job.id,
      p_source_id: job.source_id,
      p_organization_id: job.organization_id,
      p_error_message: failureMessage,
    });

    if (!error) {
      return;
    }

    logError("ai_agent_rag_indexing_fail_rpc_failed", {
      organization_id: job.organization_id,
      source_id: job.source_id,
      job_id: job.id,
      error: error.message,
    });
  } catch (error) {
    logError("ai_agent_rag_indexing_fail_rpc_threw", {
      organization_id: job.organization_id,
      source_id: job.source_id,
      job_id: job.id,
      error: errorMessage(error),
    });
  }

  const nowIso = new Date().toISOString();

  await db
    .from("agent_indexing_jobs")
    .update({
      status: "failed",
      error_message: failureMessage,
      updated_at: nowIso,
    })
    .eq("organization_id", job.organization_id)
    .eq("id", job.id);

  await db
    .from("agent_knowledge_sources")
    .update({
      indexing_status: "failed",
      indexing_error: failureMessage,
      updated_at: nowIso,
    })
    .eq("organization_id", job.organization_id)
    .eq("id", job.source_id);
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
